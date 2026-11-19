// Draft pick ownership (Nick, 2026-11-18: "keep track of draft picks traded so we can have an accurate
// standing of who has what picks since madden does not export them").
//
// EA's export has no pick list, so who owns which pick is worked out here by replaying every pick that
// changed hands, oldest first, on top of "every team owns its own picks":
//   1. Trades imported from MyMadden's trade log (the old NCL site), picks included (history `deal`).
//   2. Trades the sync found (players moved between two teams). Their picks are in
//      settings.tradePicks: filled in by the worker from the admin-approved proposal the trade matches,
//      or added by a commissioner on the Transactions tab.
//   3. settings.pickMoves: approved pick-only trades (no player moves, so a sync can never see them) and
//      moves a commissioner records or fixes by hand on the Draft picks page.
// Nothing is stored as "the standing": change or remove a move and the standing follows.
//
// A pick is (draft year, round, original team). A pick text that doesn't say whose pick it is ("2029 2nd
// round pick") is the giving team's own pick if it still has it, otherwise the one other team's pick of
// that year and round it holds; anything else is flagged for a commissioner.

import type { LeagueData, Team } from "./types";
import type { TradePicks, TxEvent, TxWeek } from "./history";
import { tradeKey, weekOrder } from "./history";
import { nextDraftYear } from "./derive";
import { parsePickParam } from "./tradeMath";

export const PICK_ROUNDS = [1, 2, 3, 4, 5, 6, 7];
const ROUND = ["", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th"];
/** How many drafts ahead the standing covers (the Trade Tool offers the same ones). */
export const PICK_YEARS = 3;

/** A pick move a commissioner recorded (or an approved pick-only trade): leagues.settings.pickMoves. */
export type PickMove = {
  id: string;
  at: string;                 // when it was recorded (ISO); moves replay in this order with the trades
  y: number; r: number;
  o?: number;                 // original team id; missing = the giving team's own (or its only one)
  from: number; to: number;   // team ids
  src: "manual" | "proposal";
  note?: string;
  by?: string;                // who recorded it (name)
  ref?: string;               // proposal id for approved pick-only trades
};

export type PickStep = { from: number; to: number; at: string | null; wk?: TxWeek; src: "mymadden" | "trade" | "proposal" | "manual"; text: string; ref?: string };
export type LedgerPick = { y: number; r: number; o: number; owner: number; n?: number; trail: PickStep[] };
export type PickLedger = {
  firstDraft: number;
  years: number[];
  /** every pick in `years`, plus any other traded pick, by pickId */
  picks: Map<string, LedgerPick>;
  /** things a commissioner should look at (a team traded a pick it didn't have, a draft that doesn't add up...) */
  notes: string[];
};

export const pickId = (y: number, r: number, o: number) => `${y}-${r}-${o}`;

/** "2029 2nd round pick (#12, via PHI)": the text stored for a pick and parsed back by parsePickText. */
export function pickText(k: { y: number; r: number; n?: number }, via?: string | null) {
  const extra = [k.n ? `#${k.n}` : "", via ? `via ${via}` : ""].filter(Boolean).join(", ");
  return `${k.y} ${ROUND[k.r] || k.r} round pick${extra ? ` (${extra})` : ""}`;
}

/** Reads a pick text: "2029 2nd round pick (#12, via PHI)", "Round 2 pick", "2028 1st". Year may be missing. */
export function parsePickText(s: string): { y?: number; r: number; n?: number; via?: string } | null {
  const r = Number(s.match(/\b([1-7])(?:st|nd|rd|th)\b/i)?.[1] || s.match(/round\s*([1-7])\b/i)?.[1] || 0);
  if (!r) return null;
  const y = Number(s.match(/\b(20\d\d)\b/)?.[1] || 0) || undefined;
  const n = Number(s.match(/#\s*(\d{1,3})/)?.[1] || 0) || undefined;
  const via = s.match(/\bvia\s+([A-Za-z]{2,4})\b/i)?.[1]?.toUpperCase();
  return { y, r, n, via };
}

type Raw = {
  order: number;              // sort key
  at: string | null; wk?: TxWeek;
  from: number; to: number;
  y: number; r: number; o?: number; n?: number;
  src: PickStep["src"]; text: string; ref?: string;
};

export type LedgerInput = {
  d: LeagueData;
  events: TxEvent[];
  tradePicks?: TradePicks;
  moves?: PickMove[];
};

/** Who owns every pick right now. */
export function buildPickLedger({ d, events, tradePicks = {}, moves = [] }: LedgerInput): PickLedger {
  const firstDraft = nextDraftYear(d);
  const years = Array.from({ length: PICK_YEARS }, (_, i) => firstDraft + i);
  const teamIds = new Set(d.teams.map((t) => t.id));
  const abbrOf = new Map(d.teams.map((t) => [t.id, t.abbr]));
  const idOf = new Map(d.teams.map((t) => [t.abbr.toUpperCase(), t.id]));
  const notes: string[] = [];
  const raws: Raw[] = [];
  const ms = (s: string | null) => (s ? Date.parse(s) || 0 : 0);

  // 1 + 2: trades in the transaction log
  const deals = new Set<string>();
  const synced = new Map<string, TxEvent[]>();
  for (const e of events) {
    if (e.kind !== "trade") continue;
    if (e.deal) {
      const key = JSON.stringify([weekOrder(e.wk), e.deal]);
      if (deals.has(key)) continue; // one event per player, same deal
      deals.add(key);
      const [ta, tb] = e.deal.teams;
      for (const [to, items] of Object.entries(e.deal.got)) {
        const toId = Number(to), fromId = toId === ta ? tb : ta;
        for (const it of items) {
          if (!it.pick) continue;
          const p = parsePickText(it.pick);
          if (!p) continue;
          raws.push({ order: weekOrder(e.wk) * 1e3, at: e.at, wk: e.wk, from: fromId, to: toId, y: p.y ?? e.wk.year + 1, r: p.r, n: p.n, o: p.via ? idOf.get(p.via) : undefined, src: "mymadden", text: it.pick });
        }
      }
    } else {
      const k = tradeKey(e);
      synced.set(k, [...(synced.get(k) || []), e]);
    }
  }
  for (const [key, list] of synced) {
    const got = tradePicks[key];
    if (!got) continue;
    const e = list[0];
    const pair = [e.from || 0, e.to || 0];
    for (const [to, texts] of Object.entries(got)) {
      const toId = Number(to), fromId = pair[0] === toId ? pair[1] : pair[0];
      for (const text of texts) {
        const p = parsePickText(text);
        if (!p) continue;
        raws.push({ order: ms(e.at) || weekOrder(e.wk) * 1e3, at: e.at, wk: e.wk, from: fromId, to: toId, y: p.y ?? e.wk.year + 1, r: p.r, n: p.n, o: p.via ? idOf.get(p.via) : undefined, src: "trade", text, ref: key });
      }
    }
  }
  // 3: recorded moves
  for (const m of moves) {
    raws.push({ order: ms(m.at), at: m.at, from: m.from, to: m.to, y: m.y, r: m.r, o: m.o, src: m.src, text: `${pickText(m)}${m.note ? ` (${m.note})` : ""}`, ref: m.ref || m.id });
  }
  // Imported trades (no time) go first by league week; then everything by when it happened.
  raws.sort((a, b) => a.order - b.order);

  const picks = new Map<string, LedgerPick>();
  const get = (y: number, r: number, o: number) => {
    const id = pickId(y, r, o);
    let p = picks.get(id);
    if (!p) { p = { y, r, o, owner: o, trail: [] }; picks.set(id, p); }
    return p;
  };
  for (const y of years) for (const r of PICK_ROUNDS) for (const t of teamIds) get(y, r, t);

  const name = (id: number) => abbrOf.get(id) || "a team no longer in the league";
  for (const x of raws) {
    if (!x.from || !x.to || x.from === x.to) continue;
    // Problems with a draft that's already happened don't matter any more.
    const note = (s: string) => { if (x.y >= firstDraft) notes.push(s); };
    let p: LedgerPick | undefined;
    if (x.o) p = get(x.y, x.r, x.o);
    else {
      const own = get(x.y, x.r, x.from);
      if (own.owner === x.from) p = own;
      else {
        const held = [...picks.values()].filter((q) => q.y === x.y && q.r === x.r && q.owner === x.from);
        if (held.length === 1) p = held[0];
        else if (held.length > 1) {
          p = held[0];
          note(`${name(x.from)} sent "${x.text}" while holding ${held.length} ${x.y} ${ROUND[x.r]}s (${held.map((q) => `via ${name(q.o)}`).join(", ")}); the tracker moved the one via ${name(p.o)}. Record the right one by hand if that's wrong.`);
        }
      }
    }
    if (!p) {
      const own = get(x.y, x.r, x.from);
      note(`${name(x.from)} sent "${x.text}" to ${name(x.to)}, but the tracker shows ${name(x.from)}'s own ${x.y} ${ROUND[x.r]} with ${name(own.owner)} and no other ${x.y} ${ROUND[x.r]}. Not moved; record which pick it was by hand.`);
      continue;
    }
    if (p.owner !== x.from) {
      note(`${name(x.from)} sent ${x.y} ${ROUND[x.r]} (${name(p.o)}'s) to ${name(x.to)}, but the tracker had it with ${name(p.owner)}. Moved anyway; check it.`);
    }
    p.owner = x.to;
    if (x.n) p.n = x.n;
    p.trail.push({ from: x.from, to: x.to, at: x.at, wk: x.wk, src: x.src, text: x.text, ref: x.ref });
  }

  // The draft that just happened: does any team have more rookies from a round than picks it held?
  // (Madden's draftRound/rookieYear; a rookie traded since shows on his new team, so this is a hint only.)
  const last = firstDraft - 1;
  const rookies = d.players.filter((p) => !p.gone && p.team && p.yearsPro === 0 && p.draft?.year === last && p.draft.round >= 1 && p.draft.round <= 7);
  if (rookies.length >= 32) {
    for (const r of PICK_ROUNDS) {
      for (const t of d.teams) {
        const had = [...picks.values()].filter((p) => p.y === last && p.r === r && p.owner === t.id).length + (picks.has(pickId(last, r, t.id)) ? 0 : 1);
        const drafted = rookies.filter((p) => p.team === t.id && p.draft.round === r).length;
        // Only "more rookies than picks": a pick trade the tracker missed. (Fewer is normal: cut or traded rookies.)
        if (drafted > had) notes.push(`${last} draft, round ${r}: ${t.abbr} has ${drafted} rookies from this round but the tracker had it holding ${had} pick${had === 1 ? "" : "s"}. A pick trade may be missing (or a rookie was traded to ${t.abbr} after the draft).`);
      }
    }
  }
  return { firstDraft, years, picks, notes };
}

/** The picks a team holds in the covered drafts, by year then round, own pick first. */
export function teamPicks(l: PickLedger, team: number) {
  return [...l.picks.values()]
    .filter((p) => p.owner === team && l.years.includes(p.y))
    .sort((a, b) => a.y - b.y || a.r - b.r || (a.o === team ? -1 : b.o === team ? 1 : a.o - b.o));
}

/** The team's own picks it no longer has, and who has them. */
export function picksGone(l: PickLedger, team: number) {
  return [...l.picks.values()].filter((p) => p.o === team && p.owner !== team && l.years.includes(p.y)).sort((a, b) => a.y - b.y || a.r - b.r);
}

/** Short label: "2029 2nd" or "2029 2nd (via PHI)". */
export function pickShort(p: { y: number; r: number; o: number }, holder: number, teams: Pick<Team, "id" | "abbr">[]) {
  const via = p.o !== holder ? teams.find((t) => t.id === p.o)?.abbr : null;
  return `${p.y} ${ROUND[p.r]}${via ? ` (via ${via})` : ""}`;
}

// ---------------------------------------------------------------- from approved proposals

type ProposalLike = { id: string; a: string; b: string; query: Record<string, string>; decidedAt?: string };

/** The picks each side of a proposal sends, as [from, to, pick]. */
function proposalPicks(p: ProposalLike, teams: Pick<Team, "id" | "abbr">[]) {
  const id = (abbr: string) => teams.find((t) => t.abbr === abbr)?.id;
  const a = id(p.a), b = id(p.b);
  if (!a || !b) return [];
  const side = (q: string | undefined, from: number, to: number) => (q || "").split(",").filter(Boolean)
    .map((x) => parsePickParam(x, teams)).filter((k): k is NonNullable<typeof k> => Boolean(k))
    .map((k) => ({ from, to, k: { ...k, o: k.o ?? from } }));
  return [...side(p.query.ka, a, b), ...side(p.query.kb, b, a)];
}

/** An approved trade with picks but no players (a sync can never see it): its pick moves. */
export function proposalPickMoves(p: ProposalLike, teams: Pick<Team, "id" | "abbr">[]): PickMove[] {
  return proposalPicks(p, teams).map(({ from, to, k }, i) => ({
    id: `${p.id}-${i}`, at: p.decidedAt || new Date().toISOString(), y: k.y, r: k.r, o: k.o, from, to, src: "proposal", ref: p.id,
    note: `approved pick-only trade ${p.a} ⇄ ${p.b}`,
  }));
}

/** settings.tradePicks entry for a synced trade that matched an approved proposal: receiving team id → pick texts. */
export function proposalTradePicks(p: ProposalLike, teams: Pick<Team, "id" | "abbr">[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const { from, to, k } of proposalPicks(p, teams)) {
    const via = k.o !== from ? teams.find((t) => t.id === k.o)?.abbr : teams.find((t) => t.id === from)?.abbr;
    (out[String(to)] ||= []).push(pickText({ y: k.y, r: k.r, n: k.s }, via));
  }
  return out;
}
