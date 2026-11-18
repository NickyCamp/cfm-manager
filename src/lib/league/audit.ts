// League rule audits (Nick, 2026-11-18): "/audit abilities", "/audit games" and "/audit players" in
// Discord, plus the Audit page in the site's admin panel, where a commissioner edits the rules.
//
// The rules live in leagues.settings.audit (AuditRules). Ability and position rules are short text,
// one rule per line, so any league can write its own:
//
//   Banned abilities           Omaha
//                              Bazooka unless THP 96        (allowed when the rating is 96+)
//                              Backyard*                    (* = anything starting with "Backyard")
//   Limited abilities          Route Technician             (1 per roster)
//                              Acrobat (per side)           (1 on offense and 1 on defense)
//                              Edge Threat / Edge Threat Elite   (1 between them)
//                              Juke Box max 2
//   Position changes allowed   OL <-> OL
//                              EDGE -> DT if WT >= 280
//                              CB -> S if AGE >= 30 and SPD <= 87
//
// What EA's export can't show, so nothing here checks it: depth charts and formation subs, store
// purchases (the Bulking Diet), and position changes made before 2026-11-18 (the transaction log
// only started recording them then).

import type { LeagueData, Player, Team } from "./types";
import { RATING_KEYS, RATING_SHORT } from "./ratings";
import type { LeagueHistory, TxEvent } from "./history";

export type AuditRules = {
  abilities: { banned: string; limited: string };
  positions: {
    changes: string;
    /** Last regular-season week (1-18) a position can change in; the playoffs are always closed. */
    lastWeek: number;
    /** Superstar / X-Factor players (dev at the time) change position once per cycle: free agency → re-sign stage. */
    eliteOnce: boolean;
  };
  games: {
    /** A player with this many catches in a game can't have more than gameShare of his team's catches. */
    gameCatches: number;
    gameShare: number;
    /** No player over this share of his team's catches for the season. */
    seasonShare: number;
    /** Passing TDs can't be more than this share of passing + rushing TDs for the season. */
    passTdShare: number;
    /** Count games whose sim status the site never saw (null) as user games. */
    includeUnknown: boolean;
    includePlayoffs: boolean;
  };
};

/** NCL's rules (Nick, 2026-11-18). New leagues start with these until a commissioner changes them. */
export const DEFAULT_AUDIT_RULES: AuditRules = {
  abilities: {
    banned: [
      "Omaha", "Film Study", "Mind Reader", "Backyard QB", "Backyard HB", "Backyard WR", "Backyard TE",
      "Bazooka unless THP 96", "Field General",
    ].join("\n"),
    limited: [
      "# Offense",
      "Route Technician", "Acrobat (per side)", "Deep Elite", "Mid Elite", "Short Elite", "Quick Jump (per side)",
      "# OL",
      "All Day", "Edge Protector", "Secure Protector",
      "# Defense",
      "Edge Threat / Edge Threat Elite", "Double Or Nothing", "Pass Committed", "One Step Ahead", "Lurker / Lurk Artist",
      "Inside Stuff", "No Outsiders", "Inside Shade", "Outside Shade",
      "Deep Zone KO", "Deep Route KO", "Deep In Zone KO", "Deep Out Zone KO", "Mid Zone KO", "Medium Route KO", "Short Route KO", "Flat Zone KO",
      "Enforcer Supreme", "Interior Threat",
    ].join("\n"),
  },
  positions: {
    changes: [
      "OL <-> OL",
      "LB <-> LB",
      "EDGE <-> EDGE",
      "S <-> S",
      "DT -> EDGE",
      "EDGE -> DT if WT >= 280",
      "S -> CB if WT <= 210",
      "CB -> S if AGE >= 30 and SPD <= 87",
    ].join("\n"),
    lastWeek: 10,
    eliteOnce: true,
  },
  games: { gameCatches: 10, gameShare: 0.5, seasonShare: 0.4, passTdShare: 0.8, includeUnknown: true, includePlayoffs: false },
};

export function auditRulesOf(settings: Record<string, unknown> | null | undefined): AuditRules {
  const s = (settings?.audit || {}) as Partial<AuditRules>;
  const d = DEFAULT_AUDIT_RULES;
  return {
    abilities: { ...d.abilities, ...(s.abilities || {}) },
    positions: { ...d.positions, ...(s.positions || {}) },
    games: { ...d.games, ...(s.games || {}) },
  };
}

// ---------- parsing ----------

export const normAbility = (s: string) => s.toLowerCase().replace(/[^a-z0-9*]/g, "");
const matches = (pattern: string, title: string) => {
  const p = normAbility(pattern), t = normAbility(title);
  return p.endsWith("*") ? t.startsWith(p.slice(0, -1)) : p === t;
};

/** Condition terms: WT, HT, AGE, OVR or a short rating name (SPD, THP…). */
const TERM = new Map<string, (x: { wt: number; ht: number; age: number; ovr?: number; r?: number[] }) => number | undefined>([
  ["WT", (x) => x.wt], ["HT", (x) => x.ht], ["AGE", (x) => x.age], ["OVR", (x) => x.ovr],
  ...RATING_KEYS.map((k, i) => [RATING_SHORT[k] || k, (x: { r?: number[] }) => x.r?.[i]] as const),
]);
type Cond = { term: string; op: ">=" | "<=" | ">" | "<" | "="; value: number };
const condText = (c: Cond) => `${c.term} ${c.op} ${c.value}`;

function parseConds(text: string, errors: string[], line: string): Cond[] {
  const out: Cond[] = [];
  for (const part of text.split(/\s+and\s+|,/i).map((x) => x.trim()).filter(Boolean)) {
    // "THP 96" alone means 96 or more
    const m = part.match(/^([A-Za-z]+)\s*(>=|<=|=>|=<|>|<|=)?\s*(\d+(?:\.\d+)?)\+?$/);
    if (!m || !TERM.has(m[1].toUpperCase())) { errors.push(`"${line}": can't read "${part}" (use e.g. WT >= 280, SPD <= 87, AGE >= 30)`); continue; }
    const op = !m[2] ? ">=" : ({ "=>": ">=", "=<": "<=" } as Record<string, Cond["op"]>)[m[2]] || (m[2] as Cond["op"]);
    out.push({ term: m[1].toUpperCase(), op, value: Number(m[3]) });
  }
  return out;
}
const test = (c: Cond, v: number | undefined) =>
  v == null ? true : c.op === ">=" ? v >= c.value : c.op === "<=" ? v <= c.value : c.op === ">" ? v > c.value : c.op === "<" ? v < c.value : v === c.value;

const lines = (text: string) => text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));

export type BannedRule = { name: string; unless?: Cond };
export type LimitRule = { names: string[]; max: number; perSide: boolean; label: string };

export function parseAbilityRules(r: AuditRules["abilities"]) {
  const errors: string[] = [];
  const banned: BannedRule[] = lines(r.banned).map((l) => {
    const m = l.match(/^(.*?)\s+unless\s+(.+)$/i);
    if (!m) return { name: l };
    const [c] = parseConds(m[2], errors, l);
    return { name: m[1].trim(), unless: c };
  });
  const limited: LimitRule[] = lines(r.limited).map((l) => {
    let s = l;
    const perSide = /\((?:per side|each side|1 offense,? 1 defense)\)/i.test(s);
    s = s.replace(/\([^)]*\)/g, "").trim();
    let max = 1;
    const mm = s.match(/\s+max\s+(\d+)$/i);
    if (mm) { max = Math.max(1, Number(mm[1])); s = s.slice(0, mm.index).trim(); }
    const names = s.split(/\s*\/\s*/).map((x) => x.trim()).filter(Boolean);
    return { names, max, perSide, label: names.join(" / ") };
  }).filter((x) => x.names.length);
  return { banned, limited, errors };
}

export const POS_GROUPS: Record<string, string[]> = {
  OL: ["LT", "LG", "C", "RG", "RT"], OT: ["LT", "RT"], OG: ["LG", "RG"], IOL: ["LG", "C", "RG"],
  LB: ["MIKE", "WILL", "SAM", "MLB", "LOLB", "ROLB"], OLB: ["WILL", "SAM", "LOLB", "ROLB"],
  EDGE: ["LEDG", "REDG", "LE", "RE"], DE: ["LEDG", "REDG", "LE", "RE"], DL: ["LEDG", "REDG", "LE", "RE", "DT"],
  S: ["FS", "SS"], DB: ["CB", "FS", "SS"], RB: ["HB"],
};
const posSet = (x: string) => POS_GROUPS[x.toUpperCase()] || [x.toUpperCase()];

export type ChangeRule = { from: string[]; to: string[]; conds: Cond[]; text: string };

export function parsePositionRules(text: string) {
  const errors: string[] = [];
  const rules: ChangeRule[] = [];
  for (const l of lines(text)) {
    const m = l.match(/^([A-Za-z]+)\s*(<->|->|→|↔)\s*([A-Za-z]+)(?:\s+if\s+(.+))?$/i);
    if (!m) { errors.push(`"${l}": write it like DT -> EDGE, OL <-> OL or EDGE -> DT if WT >= 280`); continue; }
    const conds = m[4] ? parseConds(m[4], errors, l) : [];
    const a = posSet(m[1]), b = posSet(m[3]);
    rules.push({ from: a, to: b, conds, text: l });
    if (m[2] === "<->" || m[2] === "↔") rules.push({ from: b, to: a, conds, text: l });
  }
  return { rules, errors };
}

// ---------- results ----------

export type Finding = { team: number; severity: "violation" | "watch"; rule: string; text: string; players?: number[] };
export type AuditResult = { kind: "abilities" | "games" | "players"; findings: Finding[]; notes: string[]; checked: string };

const OFFENSE = new Set(["QB", "HB", "FB", "WR", "TE", "LT", "LG", "C", "RG", "RT"]);
const SPECIAL = new Set(["K", "P", "LS"]);
const sideOf = (pos: string) => (OFFENSE.has(pos) ? "offense" : SPECIAL.has(pos) ? "special teams" : "defense");
const name = (p: Pick<Player, "first" | "last">) => `${p.first} ${p.last}`;
const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;

const rosterOf = (d: LeagueData, teamId?: number) => d.players.filter((p) => !p.gone && p.team && (!teamId || p.team === teamId));

export function auditAbilities(d: LeagueData, rules: AuditRules, teamId?: number): AuditResult {
  const { banned, limited, errors } = parseAbilityRules(rules.abilities);
  const findings: Finding[] = [];
  const thp = (p: Player, c: Cond) => TERM.get(c.term)?.({ wt: p.weight, ht: p.height, age: p.age, ovr: p.ovr, r: p.ratings });
  const byTeam = new Map<number, Player[]>();
  for (const p of rosterOf(d, teamId)) (byTeam.get(p.team) || byTeam.set(p.team, []).get(p.team)!).push(p);
  for (const [t, roster] of byTeam) {
    for (const p of roster) {
      for (const a of p.abilities) {
        const b = banned.find((x) => matches(x.name, a.title));
        if (!b) continue;
        if (b.unless && test(b.unless, thp(p, b.unless))) continue;
        const v = b.unless ? thp(p, b.unless) : undefined;
        findings.push({
          team: t, severity: "violation", rule: "Banned ability", players: [p.id],
          text: `${name(p)} (${p.pos}${p.ps ? ", PS" : ""}) has **${a.title}**${b.unless ? ` with ${b.unless.term} ${v ?? "?"} (needs ${condText(b.unless)})` : ""}`,
        });
      }
    }
    for (const rule of limited) {
      const holders = roster.flatMap((p) => p.abilities.filter((a) => rule.names.some((n) => matches(n, a.title))).map((a) => ({ p, a })));
      const groups = rule.perSide ? ["offense", "defense", "special teams"].map((s) => [s, holders.filter((h) => sideOf(h.p.pos) === s)] as const) : [["", holders] as const];
      for (const [side, hs] of groups) {
        if (hs.length <= rule.max) continue;
        findings.push({
          team: t, severity: "violation", rule: "Limited ability", players: hs.map((h) => h.p.id),
          text: `${hs.length}× **${rule.label}**${side ? ` on ${side}` : ""} (limit ${rule.max}): ${hs.map((h) => `${name(h.p)} (${h.p.pos}${h.a.title !== rule.names[0] && rule.names.length > 1 ? `, ${h.a.title}` : ""}${h.p.ps ? ", PS" : ""})`).join(", ")}`,
        });
      }
    }
  }
  const notes = errors.length ? [`Rules that couldn't be read: ${errors.join("; ")}`] : [];
  return { kind: "abilities", findings, notes, checked: `${rosterOf(d, teamId).length} rostered players (practice squads included)` };
}

/** Which position-change "cycle" a league week belongs to: free agency through the next re-sign stage. */
function cycleOf(e: TxEvent) {
  const w = e.wk;
  if (w.stage !== 2) return w.year;
  // Offseason: the re-sign stage (and anything before it) closes the season just played;
  // free agency onward belongs to the coming one. Unknown offseason names count as the coming one.
  return /re-?sign|recap|retire|pro bowl|super bowl/i.test(w.title) ? w.year : w.year + 1;
}

export function auditPlayers(d: LeagueData, h: LeagueHistory | null, rules: AuditRules, teamId?: number): AuditResult {
  const { rules: changes, errors } = parsePositionRules(rules.positions.changes);
  const findings: Finding[] = [];
  const notes: string[] = [];
  if (errors.length) notes.push(`Rules that couldn't be read: ${errors.join("; ")}`);
  const moves = (h?.events || []).filter((e) => e.kind === "position" && e.move);
  const cur = cycleOf({ wk: { year: d.season.year, stage: d.season.stage, week: d.season.week, title: d.season.title } } as TxEvent);
  // This cycle and the one before (moving back next season is checked like any other move).
  const recent = moves.filter((e) => cycleOf(e) >= cur - 1 && (!teamId || e.to === teamId));
  const players = new Map(d.players.map((p) => [p.id, p]));
  const seen = new Map<string, TxEvent[]>(); // player:cycle → moves (for the once-per-cycle rule)
  for (const e of [...recent].sort((a, b) => String(a.at).localeCompare(String(b.at)))) {
    const [from, to] = e.move!;
    const p = players.get(e.p);
    const who = `${e.name} (${from} → ${to}, ${e.wk.year} ${e.wk.title})`;
    const t = e.to || p?.team || 0;
    const snap = { ...(e.snap || { wt: p?.weight ?? 0, ht: p?.height ?? 0, age: e.age }), ovr: e.ovr };
    // Allowed move?
    const fits = changes.filter((r) => r.from.includes(from) && r.to.includes(to));
    if (!fits.length) {
      findings.push({ team: t, severity: "violation", rule: "Position change not allowed", players: [e.p], text: `${who}: no rule allows ${from} → ${to}` });
    } else if (!fits.some((r) => r.conds.every((c) => test(c, TERM.get(c.term)?.(snap))))) {
      const r = fits[0];
      const got = r.conds.map((c) => `${c.term} ${TERM.get(c.term)?.(snap) ?? "?"}`).join(", ");
      findings.push({ team: t, severity: "violation", rule: "Position change requirements", players: [e.p], text: `${who}: needs ${r.conds.map(condText).join(" and ")}, had ${got}` });
    }
    // When?
    const w = e.wk;
    if (w.stage === 1 && w.week >= 18) {
      findings.push({ team: t, severity: "violation", rule: "Position change window", players: [e.p], text: `${who}: changes are closed in the playoffs` });
    } else if (w.stage === 1 && w.week + 1 > rules.positions.lastWeek) {
      findings.push({ team: t, severity: "violation", rule: "Position change window", players: [e.p], text: `${who}: changes close after Week ${rules.positions.lastWeek}` });
    }
    // Superstar / X-Factor: once per cycle.
    if (rules.positions.eliteOnce && (e.dev ?? 0) >= 2) {
      const k = `${e.p}:${cycleOf(e)}`;
      const before = seen.get(k) || [];
      if (before.length) {
        findings.push({ team: t, severity: "violation", rule: "SS/XF once per season", players: [e.p], text: `${who}: already moved ${before.map((b) => `${b.move![0]} → ${b.move![1]} (${b.wk.title})`).join(", ")} this season` });
      }
      seen.set(k, [...before, e]);
    }
  }
  notes.push(moves.length
    ? `${recent.length} position change${recent.length === 1 ? "" : "s"} checked (this season and last).`
    : "No position changes recorded yet. The site records them from each sync starting 2026-11-18, so earlier moves aren't known.");
  notes.push("Depth charts and formation subs aren't in EA's export, so those rules can't be checked here.");
  return { kind: "players", findings, notes, checked: `${recent.length} position changes` };
}

export function auditGames(d: LeagueData, rules: AuditRules, teamId?: number): AuditResult {
  const g = rules.games;
  const teams = new Map(d.teams.map((t) => [t.id, t]));
  const players = new Map(d.players.map((p) => [p.id, p]));
  const games = d.games.filter((x) => x.stage === 1 && x.final && x.home && x.away && (g.includePlayoffs || x.week < 18)
    && (x.simmed === false || (x.simmed == null && g.includeUnknown)));
  const gameById = new Map(games.map((x) => [x.id, x]));
  const human = (t: Team | undefined) => Boolean(t?.user);
  const findings: Finding[] = [];
  const unknown = games.filter((x) => x.simmed == null).length;
  const simmed = d.games.filter((x) => x.stage === 1 && x.final && x.simmed === true).length;
  const label = (id: number) => {
    const x = gameById.get(id)!;
    return `${x.week >= 18 ? ["Wild Card", "Divisional", "Conference", "", "Super Bowl"][x.week - 18] : `Wk ${x.week + 1}`} ${teams.get(x.away)?.abbr} @ ${teams.get(x.home)?.abbr}${x.simmed == null ? " (sim?)" : ""}`;
  };

  // Per team per game, and season totals per team.
  type Agg = { rc: number; ptd: number; rtd: number; byP: Map<number, number> };
  const perGame = new Map<string, Agg>(), season = new Map<number, Agg>();
  const agg = (m: Map<string | number, Agg>, k: string | number) => m.get(k) || m.set(k, { rc: 0, ptd: 0, rtd: 0, byP: new Map() }).get(k)!;
  for (const l of d.lines) {
    if (!gameById.has(l.g) || (teamId && l.t !== teamId) || !human(teams.get(l.t))) continue;
    for (const a of [agg(perGame as Map<string | number, Agg>, `${l.g}:${l.t}`), agg(season as Map<string | number, Agg>, l.t)]) {
      a.rc += l.rc || 0; a.ptd += l.ptd || 0; a.rtd += l.rtd || 0;
      if (l.rc) a.byP.set(l.p, (a.byP.get(l.p) || 0) + l.rc);
    }
  }
  for (const [k, a] of perGame) {
    const [gid, tid] = k.split(":").map(Number);
    for (const [pid, rc] of a.byP) {
      if (rc < g.gameCatches || rc / a.rc <= g.gameShare) continue;
      const p = players.get(pid);
      findings.push({ team: tid, severity: "violation", rule: "Catches in a game", players: [pid], text: `${p ? name(p) : pid} (${p?.pos ?? "?"}): ${rc} of ${a.rc} catches (${pct(rc / a.rc)}) in ${label(gid)}; limit ${pct(g.gameShare)} at ${g.gameCatches}+` });
    }
  }
  const regDone = !d.games.some((x) => x.stage === 1 && x.week < 18 && x.home && x.away && !x.final);
  const sev: Finding["severity"] = regDone ? "violation" : "watch";
  const tail = regDone ? "" : " so far";
  for (const [tid, a] of season) {
    for (const [pid, rc] of a.byP) {
      if (a.rc < 20 || rc / a.rc <= g.seasonShare) continue;
      const p = players.get(pid);
      findings.push({ team: tid, severity: sev, rule: "Season catch share", players: [pid], text: `${p ? name(p) : pid} (${p?.pos ?? "?"}): ${rc} of ${a.rc} team catches (${pct(rc / a.rc)})${tail}; limit ${pct(g.seasonShare)}` });
    }
    const tds = a.ptd + a.rtd;
    if (tds >= 5 && a.ptd / tds > g.passTdShare) {
      const need = Math.ceil(a.ptd * (1 - g.passTdShare) / g.passTdShare - a.rtd);
      findings.push({ team: tid, severity: sev, rule: "Pass/rush TD split", text: `${a.ptd} passing to ${a.rtd} rushing TDs (${pct(a.ptd / tds)} passing)${tail}; limit ${Math.round(g.passTdShare * 100)}/${Math.round(100 - g.passTdShare * 100)}${regDone ? "" : ` · needs ${need} more rushing TD${need === 1 ? "" : "s"} at this pace`}` });
    }
  }
  const notes = [
    `${games.length} user game${games.length === 1 ? "" : "s"} checked; ${simmed} simmed game${simmed === 1 ? "" : "s"} left out${g.includePlayoffs ? "" : " (regular season only)"}.`,
  ];
  if (unknown) notes.push(`${unknown} game${unknown === 1 ? "'s" : "s'"} sim status was never seen by a sync, so ${unknown === 1 ? "it's" : "they're"} counted as user games and marked "sim?".`);
  if (!regDone) notes.push("Season limits are marked ⚠️ until the regular season ends, since they apply to final numbers.");
  return { kind: "games", findings, notes, checked: `${games.length} games` };
}

/** Every ability title the rules can match: Madden 27's list plus whatever players in this league hold. */
export function knownAbilityTitles(d: LeagueData, base: string[]) {
  return [...new Set([...base, ...d.players.flatMap((p) => p.abilities.map((a) => a.title))])].sort();
}

/** Rule names that match no ability anyone knows of (likely typos). */
export function unknownAbilityNames(rules: AuditRules["abilities"], titles: string[]) {
  const { banned, limited } = parseAbilityRules(rules);
  const names = [...banned.map((b) => b.name), ...limited.flatMap((l) => l.names)];
  return names.filter((n) => !titles.some((t) => matches(n, t)));
}
