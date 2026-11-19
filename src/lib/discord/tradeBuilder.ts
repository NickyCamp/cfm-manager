// /trade: build a trade right in Discord (Nick, 2026-11-17: "/trade and then select the team and then
// player or pick and keep having those options until team 2 and then player or pick until done").
// A private message walks through it: Team 1 → its players and picks (as many as you like) → Team 2 →
// its players and picks → review (trade score, cap warnings) → Submit, which posts it in
// #trade-proposals exactly like the site's Submit (postTradeProposal).
//
// The trade being built lives in the message itself (the embed footer, as the Trade Tool's query), so
// nothing is saved until it's submitted. Every tap answers "deferred update" and then edits the message.
import { getLeagueData } from "@/lib/league/load";
import { buildTradeData, parseTrade, type TradeData } from "@/lib/league/tradeData";
import { DEV, pickSpotText, ROUND, scoreTrade, type Pick } from "@/lib/league/tradeMath";
import { money } from "@/lib/league/format";
import { teamsOfUser } from "@/lib/marketStore";
import { userForDiscord } from "@/lib/tickets";
import { BRAND, hexColor, type Embed, type Message } from "./api";
import { leagueForGuild, type LinkedLeague } from "./links";
import { isLeagueAdmin } from "./admin";
import { teamRoles } from "./gameChannels";
import { postTradeProposal } from "./tradeChannels";
import type { ComponentInteraction } from "./marketButtons";

const APP_URL = (process.env.APP_URL || "https://cfm-manager-delta.vercel.app").replace(/\/$/, "");
const TAG = "Trade builder · ";

/** Step: a = choose Team 1, A = Team 1's assets, b = choose Team 2, B = Team 2's assets, r = review, done = posted. */
type Step = "a" | "A" | "b" | "B" | "r" | "done";
type St = { a: string; b: string; pa: number[]; pb: number[]; ka: string[]; kb: string[]; st: Step };

const empty = (): St => ({ a: "", b: "", pa: [], pb: [], ka: [], kb: [], st: "a" });
function encode(s: St) {
  const q = new URLSearchParams({ st: s.st });
  if (s.a) q.set("a", s.a);
  if (s.b) q.set("b", s.b);
  if (s.pa.length) q.set("pa", s.pa.join("."));
  if (s.pb.length) q.set("pb", s.pb.join("."));
  if (s.ka.length) q.set("ka", s.ka.join("."));
  if (s.kb.length) q.set("kb", s.kb.join("."));
  return TAG + q.toString();
}
function decode(msg: ComponentInteraction["message"]): St | null {
  const text = msg?.embeds?.[0]?.footer?.text || "";
  if (!text.startsWith(TAG)) return null;
  const q = new URLSearchParams(text.slice(TAG.length));
  const list = (k: string) => (q.get(k) || "").split(".").filter(Boolean);
  return { a: q.get("a") || "", b: q.get("b") || "", pa: list("pa").map(Number), pb: list("pb").map(Number), ka: list("ka"), kb: list("kb"), st: (q.get("st") as Step) || "a" };
}
/** The Trade Tool's query for this trade. */
const query = (s: St): Record<string, string> => ({ a: s.a, b: s.b, pa: s.pa.join(","), pb: s.pb.join(","), ka: s.ka.join(","), kb: s.kb.join(",") });
/** Builder pick value → Pick: "2028-1" automatic, "2028-1-12" #12 in the round, "2028-1-u" unknown. */
const pickOf = (x: string): Pick => { const [y, r, n] = x.split("-"); return n === "u" ? { y: +y, r: +r, u: true } : Number(n) ? { y: +y, r: +r, s: Number(n) } : { y: +y, r: +r }; };
const baseKey = (x: string) => x.split("-").slice(0, 2).join("-");
const sideOf = (s: St): "a" | "b" => (s.st === "b" || s.st === "B" ? "b" : "a");

// ---------------------------------------------------------------- rendering

function render(lg: LinkedLeague, td: TradeData, s: St, note = ""): Message {
  const team = (abbr: string) => td.teams.find((t) => t.abbr === abbr);
  const byId = new Map(td.players.map((p) => [p.id, p]));
  const assets = (abbr: string, ids: number[], picks: string[]) => {
    const t = team(abbr);
    const lines = [
      ...ids.map((id) => byId.get(id)).filter(Boolean).map((p) => `• ${p!.pos} **${p!.n}** · ${p!.ovr} OVR · ${p!.ur} UR · ${money(p!.hits[0])}`),
      ...picks.map((x) => { const k = pickOf(x); return `• ${k.y} ${ROUND[k.r]} round pick${t ? ` · ${pickSpotText(k, t, td.firstDraft, td.orderFinal)}` : ""}`; }),
    ];
    return lines.length ? lines.join("\n") : "_nothing yet_";
  };
  const ta = team(s.a), tb = team(s.b);
  const fields: Embed["fields"] = [];
  if (ta) fields.push({ name: `Team 1: ${ta.name} sends`, value: assets(s.a, s.pa, s.ka) });
  if (tb) fields.push({ name: `Team 2: ${tb.name} sends`, value: assets(s.b, s.pb, s.kb) });

  const prompt: Record<Step, string> = {
    a: "**Step 1:** pick **Team 1**.",
    A: `**Step 2:** add what the **${ta?.name || "Team 1"}** send: players and picks, as many as you like. Picks get their spot automatically; use the pick-number menu to set #1–32 or unknown. Then tap **Next: Team 2**.`,
    b: "**Step 3:** pick **Team 2**.",
    B: `**Step 4:** add what the **${tb?.name || "Team 2"}** send. Then tap **Review**.`,
    r: "**Review.** Submit posts it in #trade-proposals for the admins to vote on.",
    done: "",
  };
  let color = BRAND;
  if (s.st === "r" && ta && tb) {
    const { a, b } = parseTrade(td, query(s));
    const sc = scoreTrade({ players: td.players, teams: td.teams, years: td.years, firstDraft: td.firstDraft, a, b, orderFinal: td.orderFinal });
    if (sc) {
      color = hexColor(sc.favored?.primary || ta.primary);
      const over = [sc.a, sc.b].filter((x) => x.capNow.after < 0).map((x) => `${x.team.abbr} (${money(x.capNow.after)})`);
      fields.push({
        name: "Trade score",
        value: [
          `**${sc.verdict}** · ${ta.abbr} ${sc.score} · ${100 - sc.score} ${tb.abbr}`,
          `Grades: ${ta.abbr} **${sc.a.grade}** · ${tb.abbr} **${sc.b.grade}**`,
          `${sc.a.capNow.y} cap space after: ${ta.abbr} ${money(sc.a.capNow.after)} · ${tb.abbr} ${money(sc.b.capNow.after)}`,
          over.length ? `⚠️ Over the cap: ${over.join(", ")}. Madden won't accept it yet.` : "",
        ].filter(Boolean).join("\n"),
      });
    }
  }
  const embed: Embed = {
    title: s.st === "done" ? "Trade submitted ✅" : "Build a trade",
    color,
    description: [note, prompt[s.st]].filter(Boolean).join("\n\n"),
    fields,
    footer: { text: encode(s) },
  };
  return { embeds: [embed], components: s.st === "done" ? [] : components(td, s, lg.slug) };
}

function components(td: TradeData, s: St, slug: string): unknown[] {
  const rows: unknown[] = [];
  const btn = (id: string, label: string, style = 2, disabled = false) => ({ type: 2, style, label, custom_id: `tb|${id}`, disabled });
  const cancel = btn("cancel", "Cancel", 4);

  if (s.st === "a" || s.st === "b") {
    const taken = s.st === "b" ? s.a : "";
    for (const conf of ["AFC", "NFC"]) {
      const teams = td.teams.filter((t) => (t.conf === "AFC") === (conf === "AFC")).filter((t) => t.abbr !== taken);
      rows.push({ type: 1, components: [{ type: 3, custom_id: `tb|team|${conf}`, placeholder: `${conf} teams`, options: teams.slice(0, 25).map((t) => ({ label: t.name, value: t.abbr })) }] });
    }
    rows.push({ type: 1, components: [...(s.st === "b" ? [btn("edit1", "◀ Back to Team 1")] : []), cancel] });
    return rows;
  }

  if (s.st === "A" || s.st === "B") {
    const side = sideOf(s);
    const abbr = s[side];
    const t = td.teams.find((x) => x.abbr === abbr);
    const chosen = new Set(side === "a" ? s.pa : s.pb);
    const roster = td.players.filter((p) => p.t === t?.id && !chosen.has(p.id)).sort((x, y) => y.ur - x.ur || y.ovr - x.ovr).slice(0, 25);
    if (roster.length) {
      rows.push({ type: 1, components: [{
        type: 3, custom_id: "tb|player", placeholder: `Add a ${abbr} player (best 25 by UR; 🔎 Find for others)`, min_values: 1, max_values: Math.min(5, roster.length),
        options: roster.map((p) => ({ label: `${p.n} · ${p.pos} ${p.ovr}`.slice(0, 100), value: String(p.id), description: `${p.ur} UR · ${p.spd} SPD · age ${p.age}${p.dev ? ` · ${DEV[p.dev]}` : ""} · ${money(p.hits[0])}${p.ps ? " · PS" : ""}`.slice(0, 100) })),
      }] });
    }
    const have = new Set((side === "a" ? s.ka : s.kb).map((x) => x.split("-").slice(0, 2).join("-")));
    const pickOpts = td.draftYears.flatMap((y) => [1, 2, 3, 4, 5, 6, 7].map((r) => ({ y, r }))).filter((k) => !have.has(`${k.y}-${k.r}`)).slice(0, 25);
    if (pickOpts.length && t) {
      rows.push({ type: 1, components: [{
        type: 3, custom_id: "tb|pick", placeholder: `Add a ${abbr} draft pick`, min_values: 1, max_values: Math.min(5, pickOpts.length),
        options: pickOpts.map((k) => ({ label: `${k.y} ${ROUND[k.r]} round`, value: `${k.y}-${k.r}`, description: pickSpotText(k, t, td.firstDraft, td.orderFinal).slice(0, 100) })),
      }] });
    }
    const sidePicks = side === "a" ? s.ka : s.kb;
    if (sidePicks.length && t) {
      rows.push({ type: 1, components: [{
        type: 3, custom_id: "tb|spot", placeholder: "Set a pick's number in the round (1–32 or unknown)",
        options: sidePicks.slice(0, 25).map((x) => { const k = pickOf(x); return { label: `${k.y} ${ROUND[k.r]} round pick`, value: baseKey(x), description: pickSpotText(k, t, td.firstDraft, td.orderFinal).slice(0, 100) }; }),
      }] });
    }
    const mine = [...(side === "a" ? s.pa : s.pb).map((id) => ({ v: `p:${id}`, l: td.players.find((p) => p.id === id)?.n || String(id) })), ...(side === "a" ? s.ka : s.kb).map((x) => ({ v: `k:${x}`, l: `${x.split("-")[0]} ${ROUND[Number(x.split("-")[1])]} round pick` }))];
    if (mine.length) {
      rows.push({ type: 1, components: [{ type: 3, custom_id: "tb|remove", placeholder: "Remove something", min_values: 1, max_values: mine.length, options: mine.slice(0, 25).map((x) => ({ label: x.l.slice(0, 100), value: x.v })) }] });
    }
    rows.push({ type: 1, components: [
      btn("find", "🔎 Find player"),
      btn(side === "a" ? "team1" : "team2", "Change team"),
      side === "a" ? btn("next", "Next: Team 2 ▶", 1) : btn("review", "Review ▶", 1),
      cancel,
    ] });
    return rows;
  }

  // review
  const q = new URLSearchParams(Object.entries(query(s)).filter(([, v]) => v));
  rows.push({ type: 1, components: [
    btn("submit", "Submit to #trade-proposals", 3, !(s.pa.length + s.pb.length + s.ka.length + s.kb.length)),
    btn("edit1", "Edit Team 1"), btn("edit2", "Edit Team 2"), cancel,
    { type: 2, style: 5, label: "Open in Trade Tool", url: `${APP_URL}/l/${slug}/trades?${q.toString()}` },
  ] });
  return rows;
}

// ---------------------------------------------------------------- entry points

async function loadTd(slug: string) {
  const d = await getLeagueData(slug);
  return d ? buildTradeData(d) : null;
}

/** /trade (server only). */
export async function tradeBuilderStart(lg: LinkedLeague): Promise<Message> {
  const td = await loadTd(lg.slug);
  if (!td) return { content: "No league data yet." };
  return render(lg, td, empty());
}

export type BuilderAnswer = { modal?: unknown; message?: Message; reply?: string };

/** The "Find player" button opens a name box (must be answered at once, without loading anything). */
export function findPlayerModal(): unknown {
  return { type: 9, data: { custom_id: "tb|findm", title: "Find a player", components: [{ type: 1, components: [{ type: 4, custom_id: "name", label: "Player name (or part of it)", style: 1, min_length: 2, max_length: 40, required: true }] }] } };
}

/** "Set a pick's number" select: opens a box for 1–32 / unknown / blank (automatic). Answered at once from the message. */
export function pickSpotModal(i: ComponentInteraction): unknown {
  const key = String(i.data?.values?.[0] || "");
  const s = decode(i.message);
  const cur = s ? [...s.ka, ...s.kb].find((x) => baseKey(x) === key) : undefined;
  const k = pickOf(cur || key);
  return { type: 9, data: { custom_id: `tb|spotm|${key}`, title: `${k.y} ${ROUND[k.r]} round pick`.slice(0, 45), components: [{ type: 1, components: [{
    type: 4, custom_id: "spot", label: "Pick # in the round: 1–32, or unknown", style: 1, max_length: 7, required: false,
    placeholder: "e.g. 12, or unknown. Blank = automatic", value: k.u ? "unknown" : k.s ? String(k.s) : undefined,
  }] }] } };
}

/** Any other tap or the name box: returns the updated builder (and maybe a private note). */
export async function tradeBuilderTap(i: ComponentInteraction): Promise<BuilderAnswer> {
  const lg = i.guild_id ? await leagueForGuild(i.guild_id).catch(() => null) : null;
  if (!lg) return { reply: "This server isn't linked to a league any more." };
  const td = await loadTd(lg.slug);
  if (!td) return { reply: "No league data yet." };
  const s = decode(i.message) || empty();
  const [, action] = String(i.data?.custom_id || "").split("|");
  const values = i.data?.values || [];
  const side = sideOf(s);
  const P = side === "a" ? "pa" : "pb", K = side === "a" ? "ka" : "kb";
  let note = "";

  switch (action) {
    case "team": {
      const abbr = values[0];
      if (s.st === "a" || (s.st === "A")) { if (abbr !== s.a) { s.a = abbr; s.pa = []; s.ka = []; } s.st = "A"; }
      else { if (abbr !== s.b) { s.b = abbr; s.pb = []; s.kb = []; } s.st = "B"; }
      break;
    }
    case "player": s[P] = [...new Set([...s[P], ...values.map(Number)])]; break;
    case "pick": s[K] = [...new Set([...s[K], ...values])]; break;
    case "remove":
      s[P] = s[P].filter((id) => !values.includes(`p:${id}`));
      s[K] = s[K].filter((x) => !values.includes(`k:${x}`));
      break;
    case "findm": {
      const name = String(i.data?.components?.[0]?.components?.[0]?.value || "").trim().toLowerCase();
      const t = td.teams.find((x) => x.abbr === s[side]);
      const hits = td.players.filter((p) => p.t === t?.id && p.n.toLowerCase().includes(name) && !s[P].includes(p.id)).sort((x, y) => y.ovr - x.ovr);
      if (!hits.length) note = `No ${s[side]} player matches "${name}".`;
      else { s[P] = [...s[P], hits[0].id]; if (hits.length > 1) note = `Added ${hits[0].n}. Also matching: ${hits.slice(1, 6).map((p) => p.n).join(", ")}.`; }
      break;
    }
    case "spotm": {
      const key = String(i.data?.custom_id || "").split("|")[2] || "";
      const raw = String(i.data?.components?.[0]?.components?.[0]?.value || "").trim().toLowerCase().replace(/^#/, "");
      const n = Number(raw);
      let val: string | null = null;
      if (!raw || raw === "auto") val = key;
      else if (["unknown", "u", "?", "tbd", "unk"].includes(raw)) val = `${key}-u`;
      else if (Number.isInteger(n) && n >= 1 && n <= 32) val = `${key}-${n}`;
      if (!val) { note = `"${raw}" isn't a pick number. Use 1–32, unknown, or leave it blank for automatic.`; break; }
      if (!s[K].some((x) => baseKey(x) === key)) { note = "That pick isn't in this side of the trade any more."; break; }
      s[K] = s[K].map((x) => (baseKey(x) === key ? val! : x));
      const k = pickOf(val), t = td.teams.find((x) => x.abbr === s[side]);
      note = `${k.y} ${ROUND[k.r]} round pick: ${t ? pickSpotText(k, t, td.firstDraft, td.orderFinal) : "updated"}.`;
      break;
    }
    case "team1": s.st = "a"; break;
    case "team2": s.st = "b"; break;
    case "next": s.st = s.b ? "B" : "b"; break;
    case "review": s.st = "r"; break;
    case "edit1": s.st = s.a ? "A" : "a"; break;
    case "edit2": s.st = s.b ? "B" : "b"; break;
    case "cancel": return { message: { embeds: [{ title: "Trade builder closed", color: BRAND, description: "Nothing was posted. Run /trade to start again." }], components: [] } };
    case "submit": {
      const why = await canSubmit(i, lg, td, s);
      if (why) return { reply: why };
      const discordId = i.member?.user.id;
      const name = i.member?.user.global_name || i.member?.user.username || "someone";
      try {
        const msg = await postTradeProposal(lg.slug, query(s), { discordId, name });
        s.st = "done";
        return { message: render(lg, td, s, msg) };
      } catch (e) {
        return { reply: (e as Error).message };
      }
    }
  }
  return { message: render(lg, td, s, note) };
}

/** Who can submit: a league admin, someone with either team's role, or the site user who runs either team. */
async function canSubmit(i: ComponentInteraction, lg: LinkedLeague, td: TradeData, s: St): Promise<string | null> {
  if (!s.a || !s.b) return "Pick both teams first.";
  if (await isLeagueAdmin(i).catch(() => false)) return null;
  const ids = td.teams.filter((t) => t.abbr === s.a || t.abbr === s.b).map((t) => t.id);
  const d = await getLeagueData(lg.slug);
  if (d && i.guild_id) {
    const roles = await teamRoles(i.guild_id, d.teams).catch(() => new Map<number, string>());
    const mine = new Set(i.member?.roles || []);
    if (ids.some((id) => roles.get(id) && mine.has(roles.get(id)!))) return null;
  }
  const user = i.member?.user.id ? await userForDiscord(i.member.user.id).catch(() => null) : null;
  if (user) {
    const runs = (await teamsOfUser(lg.id, user).catch(() => [] as string[])).map((x) => x.toLowerCase());
    if (runs.includes(s.a.toLowerCase()) || runs.includes(s.b.toLowerCase())) return null;
  }
  return `Only the ${s.a} or ${s.b} managers (their team role) or a league admin can submit this trade.`;
}
