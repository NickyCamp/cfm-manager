// Discord "Transactions" category (Nick, 2026-11-17): bot-only channels that each list what one
// sync newly recorded: scores, dev changes, injuries, ability changes, rating and trait changes,
// cuts, extensions, trades and position changes. This file is pure (prev build vs next build →
// messages per channel); txChannels.ts makes the channels and the sync worker posts.
import type { LeagueData, Player } from "../league/types";
import { DEV_LABEL } from "../league/types";
import { money } from "../league/format";
import { weekTitle } from "../league/derive";
import { RATING_KEYS } from "../league/ratings";
import { diffLeague, type C } from "../league/history";
import { BRAND, type Message } from "./api";
import { tradeTransactionPosts } from "./tradeTransactions";
import type { TradeChannels } from "./tradeChannels";

export const TX_CHANNELS = [
  { key: "scores", name: "scores", title: "🏈 Final scores", topic: "Final scores, posted by the bot after each sync." },
  { key: "dev", name: "dev-changes", title: "⭐ Dev trait changes", topic: "Dev trait upgrades and downgrades, posted by the bot after each sync." },
  { key: "injuries", name: "injuries", title: "🤕 Injuries", topic: "New injuries and IR moves, posted by the bot after each sync." },
  { key: "abilities", name: "ability-changes", title: "🎖️ Ability changes", topic: "Abilities gained, lost or changed tier, posted by the bot after each sync." },
  { key: "ratingsUp", name: "ratings-up", title: "📈 Ratings & traits up", topic: "Overall and rating increases and traits gained, posted by the bot after each sync." },
  { key: "ratingsDown", name: "ratings-down", title: "📉 Ratings & traits down", topic: "Overall and rating drops and traits lost, posted by the bot after each sync." },
  { key: "cuts", name: "cuts", title: "✂️ Cuts", topic: "Players released, with the dead money left behind, posted by the bot after each sync." },
  { key: "extensions", name: "extensions", title: "📝 Extensions", topic: "Extensions, new deals and restructures, posted by the bot after each sync." },
  { key: "trades", name: "trades", title: "🔁 Trades", topic: "Trades as they happened in Madden, posted by the bot after each sync." },
  { key: "positions", name: "position-changes", title: "🔀 Position changes", topic: "Players moved to a new position, posted by the bot after each sync." },
] as const;
export type TxKey = (typeof TX_CHANNELS)[number]["key"];
export type TxChannelsState = { categoryId: string; channels: Partial<Record<TxKey, string>> };

/** Most messages one channel gets per sync (a progression week changes ratings for most of the league). */
const MAX_MSGS = 10;
const DESC_MAX = 3900;

// Short rating names, Madden style. Confidence is left out: it moves with every game and would bury the rest.
const SHORT: Record<string, string> = {
  accelRating: "ACC", agilityRating: "AGI", awareRating: "AWR", bCVRating: "BCV", blockShedRating: "BSH", breakSackRating: "BSK",
  breakTackleRating: "BTK", cITRating: "CIT", carryRating: "CAR", catchRating: "CTH", changeOfDirectionRating: "COD", confRating: "CNF",
  finesseMovesRating: "FMV", hitPowerRating: "POW", impactBlockRating: "IBL", injuryRating: "INJ", jukeMoveRating: "JKM", jumpRating: "JMP",
  kickAccRating: "KAC", kickPowerRating: "KPW", kickRetRating: "KR", leadBlockRating: "LBK", longSnapRating: "LS", manCoverRating: "MCV",
  passBlockFinesseRating: "PBF", passBlockPowerRating: "PBP", passBlockRating: "PBK", playActionRating: "PAC", playRecRating: "PRC",
  powerMovesRating: "PMV", pressRating: "PRS", pursuitRating: "PUR", releaseRating: "RLS", routeRunDeepRating: "DRR", routeRunMedRating: "MRR",
  routeRunShortRating: "SRR", runBlockFinesseRating: "RBF", runBlockPowerRating: "RBP", runBlockRating: "RBK", specCatchRating: "SPC",
  speedRating: "SPD", spinMoveRating: "SPM", staminaRating: "STA", stiffArmRating: "SFA", strengthRating: "STR", tackleRating: "TAK",
  throwAccDeepRating: "DAC", throwAccMidRating: "MAC", throwAccRating: "TAC", throwAccShortRating: "SAC", throwOnRunRating: "TOR",
  throwPowerRating: "THP", throwUnderPressureRating: "TUP", toughRating: "TGH", truckRating: "TRK", zoneCoverRating: "ZCV",
};
const SKIP_RATINGS = new Set(["confRating"]);

const TRAIT_LABEL: Record<string, string> = {
  bigHitTrait: "Big Hitter", clutchTrait: "Clutch", coverBallTrait: "Covers Ball", dLBullRushTrait: "DL Bull Rush", dLSpinTrait: "DL Spin",
  dLSwimTrait: "DL Swim", dropOpenPassTrait: "Drops Open Passes", feetInBoundsTrait: "Feet In Bounds", fightForYardsTrait: "Fights For Yards",
  highMotorTrait: "High Motor", hPCatchTrait: "High-Point Catch", lBStyleTrait: "LB Style", penaltyTrait: "Penalty", playBallTrait: "Plays Ball",
  posCatchTrait: "Possession Catch", predictTrait: "Predictable", qBStyleTrait: "QB Style", sensePressureTrait: "Senses Pressure",
  sidelineCatchTrait: "Sideline Catch", stripBallTrait: "Strips Ball", throwAwayTrait: "Throws Ball Away", tightSpiralTrait: "Tight Spiral",
  yACCatchTrait: "YAC Catch",
};
/** "someNewThingTrait" → "Some New Thing" for any trait EA adds that isn't named above. */
export const traitLabel = (k: string) =>
  TRAIT_LABEL[k] || k.replace(/Trait$/, "").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase()).replace(/\b([A-Z]) (?=[A-Z]\b)/g, "$1");

type Opts = { appUrl: string; slug: string; leagueName: string; trade: TradeChannels | null; guildId?: string };

/** Everything one sync newly recorded, as messages per channel. Empty when nothing new was pulled. */
export function transactionPosts(prev: LeagueData | null, next: LeagueData, o: Opts): Partial<Record<TxKey, Message[]>> {
  if (!prev || prev.pulledAt === next.pulledAt) return {};
  const url = (path = "") => `${o.appUrl}/l/${o.slug}${path}`;
  const teams = new Map(next.teams.map((t) => [t.id, t]));
  const abbr = (id: number | undefined) => (id ? teams.get(id)?.abbr || "?" : "FA");
  const who = (p: { id: number; first: string; last: string; pos: string; ovr: number; team: number }) =>
    `[**${p.first} ${p.last}**](${url(`/players/${p.id}`)}) (${p.pos}, ${abbr(p.team)}, ${p.ovr})`;
  const footer = { text: `${o.leagueName} · ${next.season.year} ${next.season.title} · sync of ${new Date(next.pulledAt).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} ET` };
  const meta = Object.fromEntries(TX_CHANNELS.map((c) => [c.key, c])) as Record<TxKey, (typeof TX_CHANNELS)[number]>;
  const list = (key: TxKey, lines: string[], link = url("/transactions")) => posts(meta[key].title, lines, link, BRAND, footer, url("/transactions"));

  const before = new Map(prev.players.filter((p) => !p.gone).map((p) => [p.id, p]));
  const both: [Player, Player][] = [];
  for (const p of next.players) {
    const old = before.get(p.id);
    if (!p.gone && old) both.push([old, p]);
  }
  const rostered = (p: Player) => p.team > 0;
  const out: Partial<Record<TxKey, Message[]>> = {};

  // Scores: games that went final since the last sync (same season), one post per week.
  if (prev.season.year === next.season.year) {
    const was = new Map(prev.games.map((g) => [g.id, g]));
    const finals = next.games.filter((g) => g.final && g.home && g.away && !was.get(g.id)?.final);
    const byWeek = new Map<string, typeof finals>();
    for (const g of finals) { const k = weekTitle(next, g.stage, g.week); byWeek.set(k, [...(byWeek.get(k) || []), g]); }
    const msgs: Message[] = [];
    for (const [title, games] of byWeek) {
      const lines = games.map((g) => {
        const a = `${abbr(g.away)} ${g.as}`, h = `${abbr(g.home)} ${g.hs}`;
        return `${g.as > g.hs ? `**${a}**` : a} @ ${g.hs > g.as ? `**${h}**` : h}${g.simmed ? " · sim" : ""} · [box score](${url(`/games/${g.id}`)})`;
      });
      msgs.push(...posts(`🏈 Final scores: ${title}`, lines, url("/scores"), BRAND, footer, url("/scores")));
    }
    if (msgs.length) out.scores = msgs.slice(0, MAX_MSGS);
  }

  // Dev trait changes.
  const dev = both.filter(([a, b]) => a.dev !== b.dev && rostered(b)).sort(([, x], [, y]) => y.dev - x.dev || y.ovr - x.ovr)
    .map(([a, b]) => `${b.dev > a.dev ? "⬆️" : "⬇️"} ${who(b)}: ${DEV_LABEL[a.dev]} → **${DEV_LABEL[b.dev]}**`);
  if (dev.length) out.dev = list("dev", dev, url("/dev"));

  // Injuries: newly hurt, hurt again for longer, or moved on/off IR.
  const inj: { p: Player; line: string }[] = [];
  for (const [a, b] of both) {
    if (!rostered(b)) continue;
    const wk = (n: number) => `${n} wk${n === 1 ? "" : "s"}`;
    if (b.injury > 0 && a.injury === 0) inj.push({ p: b, line: `🤕 ${who(b)}: out ${wk(b.injury)}${b.ir ? " · on IR" : ""}` });
    else if (b.injury > a.injury && a.injury > 0) inj.push({ p: b, line: `🤕 ${who(b)}: setback, now out ${wk(b.injury)} (was ${wk(a.injury)})${b.ir ? " · on IR" : ""}` });
    else if (b.ir && !a.ir) inj.push({ p: b, line: `🏥 ${who(b)}: placed on IR${b.injury ? `, out ${wk(b.injury)}` : ""}` });
    else if (!b.ir && a.ir) inj.push({ p: b, line: `✅ ${who(b)}: activated from IR` });
  }
  if (inj.length) out.injuries = list("injuries", inj.sort((x, y) => y.p.ovr - x.p.ovr).map((x) => x.line));

  // Ability changes: gained, lost, or the same ability at a new tier.
  const ab: { p: Player; line: string }[] = [];
  for (const [a, b] of both) {
    if (!rostered(b)) continue;
    const was = new Map(a.abilities.map((x) => [x.title, x.tier])), now = new Map(b.abilities.map((x) => [x.title, x.tier]));
    const bits: string[] = [];
    for (const [t, tier] of now) {
      if (!was.has(t)) bits.push(`➕ ${t}${tier ? ` (${tier})` : ""}`);
      else if (was.get(t) !== tier) bits.push(`🔁 ${t}: ${was.get(t) || "?"} → ${tier || "?"}`);
    }
    for (const [t, tier] of was) if (!now.has(t)) bits.push(`➖ ${t}${tier ? ` (${tier})` : ""}`);
    if (bits.length) ab.push({ p: b, line: `${who(b)}: ${bits.join(" · ")}` });
  }
  if (ab.length) out.abilities = list("abilities", ab.sort((x, y) => y.p.ovr - x.p.ovr).map((x) => x.line), url("/abilities"));

  // Ratings and traits, split by direction (Nick, 2026-11-17): increases and traits gained in #ratings-up,
  // drops and traits lost in #ratings-down. A player with both shows in both, each with its own side.
  const prevTraits = prev.traitKeys || [], nextTraits = next.traitKeys || [];
  const up: { p: Player; d: number; line: string }[] = [], down: { p: Player; d: number; line: string }[] = [];
  for (const [a, b] of both) {
    if (!rostered(b)) continue;
    const rat = { up: [] as { s: string; d: number }[], down: [] as { s: string; d: number }[] };
    const tr = { up: [] as string[], down: [] as string[] };
    if (a.ratings && b.ratings) {
      RATING_KEYS.forEach((k, i) => {
        const from = a.ratings![i], to = b.ratings![i];
        if (from == null || to == null || from === to || SKIP_RATINGS.has(k)) return;
        rat[to > from ? "up" : "down"].push({ s: `${SHORT[k] || k} ${from}→${to}`, d: Math.abs(to - from) });
      });
    }
    if (a.traits && b.traits && prevTraits.length && nextTraits.length) {
      nextTraits.forEach((k, i) => {
        const j = prevTraits.indexOf(k);
        if (j < 0) return;
        const from = a.traits![j], to = b.traits![i];
        if (from == null || to == null || from === to) return;
        const onOff = (from === 0 || from === 1) && (to === 0 || to === 1);
        tr[to > from ? "up" : "down"].push(onOff ? `${to ? "➕" : "➖"} ${traitLabel(k)}` : `${traitLabel(k)} ${from}→${to}`);
      });
    }
    for (const side of ["up", "down"] as const) {
      const ovrMoved = side === "up" ? b.ovr > a.ovr : b.ovr < a.ovr;
      const r = rat[side].sort((x, y) => y.d - x.d);
      if (!ovrMoved && !r.length && !tr[side].length) continue;
      const bits: string[] = [];
      if (r.length) bits.push(r.slice(0, 8).map((x) => x.s).join(", ") + (r.length > 8 ? `, +${r.length - 8} more` : ""));
      if (tr[side].length) bits.push(`traits: ${tr[side].join(", ")}`);
      const head = ovrMoved ? `${side === "up" ? "⬆️" : "⬇️"} ${who(b)} **${a.ovr}→${b.ovr} OVR**` : `${side === "up" ? "↗️" : "↘️"} ${who(b)}`;
      (side === "up" ? up : down).push({ p: b, d: Math.abs(b.ovr - a.ovr), line: `${head}${bits.length ? `\n  ${bits.join(" · ")}` : ""}` });
    }
  }
  const order = (x: { p: Player; d: number }, y: { p: Player; d: number }) => y.d - x.d || y.p.ovr - x.p.ovr;
  if (up.length) out.ratingsUp = list("ratingsUp", up.sort(order).map((x) => x.line));
  if (down.length) out.ratingsDown = list("ratingsDown", down.sort(order).map((x) => x.line));

  // Position changes.
  const pos = both.filter(([a, b]) => a.pos !== b.pos && rostered(b)).sort(([, x], [, y]) => y.ovr - x.ovr)
    .map(([a, b]) => `🔀 ${who(b)}: ${a.pos} → **${b.pos}**`);
  if (pos.length) out.positions = list("positions", pos);

  // Cuts and extensions come from the same diff as the site's Transactions tab, so they agree.
  const events = diffLeague(prev, next, next.pulledAt);
  const deal = (c: C) => `${c[0]} yr${c[0] === 1 ? "" : "s"}, ${money(c[2] + c[3])}${c[3] ? ` (${money(c[3])} bonus)` : ""}`;
  const cuts: { ovr: number; line: string }[] = [];
  const ext: { ovr: number; line: string }[] = [];
  for (const e of events) {
    if (e.kind === "released") {
      const old = before.get(e.p);
      const dead = old?.contract.releasePenalty || 0, saved = old ? old.contract.capHit - dead : 0;
      cuts.push({ ovr: e.ovr, line: `✂️ ${abbr(e.from)} cut [**${e.name}**](${url(`/players/${e.p}`)}) (${e.pos}, ${e.ovr}${e.dev ? ` ${DEV_LABEL[e.dev as 0 | 1 | 2 | 3]}` : ""}, age ${e.age})${old ? ` · dead money ${money(dead)} · saves ${money(saved)}` : ""}` });
    } else if (e.kind === "extended" || e.kind === "restructured") {
      const t = abbr(e.to), name = `[**${e.name}**](${url(`/players/${e.p}`)}) (${e.pos}, ${e.ovr})`;
      const hit = e.before && e.after ? ` · cap hit ${money(e.before[4])} → ${money(e.after[4])}` : "";
      ext.push({
        ovr: e.ovr,
        line: e.kind === "restructured"
          ? `🔧 ${t} restructured ${name}: ${money(e.before ? e.before[3] : 0)} → ${money(e.after ? e.after[3] : 0)} bonus${hit}`
          : `📝 ${t} extended ${name}: ${e.after ? deal(e.after) : "new deal"}${e.before ? ` (was ${deal(e.before)})` : ""}${hit}`,
      });
    }
  }
  if (cuts.length) out.cuts = list("cuts", cuts.sort((x, y) => y.ovr - x.ovr).map((x) => x.line), url("/cap"));
  if (ext.length) out.extensions = list("extensions", ext.sort((x, y) => y.ovr - x.ovr).map((x) => x.line), url("/cap"));

  // Trades: the same post as #trade-transactions (linked to the approved proposal when there is one).
  const trades = tradeTransactionPosts(prev, next, o.trade || { categoryId: "", channelId: "", proposals: {} }, o.guildId, o.appUrl, o.slug);
  if (trades.length) out.trades = trades.slice(0, MAX_MSGS);

  return out;
}

/** Lines → messages: one embed each (Discord caps a message at 6,000 characters), at most MAX_MSGS. */
function posts(title: string, lines: string[], link: string, color: number, footer: { text: string }, more: string): Message[] {
  const pages: string[][] = [[]];
  let size = 0;
  for (const l of lines) {
    if (size + l.length + 1 > DESC_MAX && pages[pages.length - 1].length) { pages.push([]); size = 0; }
    pages[pages.length - 1].push(l.slice(0, DESC_MAX));
    size += l.length + 1;
  }
  let shown = pages.slice(0, MAX_MSGS);
  if (pages.length > MAX_MSGS) {
    const left = pages.slice(MAX_MSGS).reduce((n, p) => n + p.length, 0);
    const last = [...shown[shown.length - 1]];
    while (last.join("\n").length > DESC_MAX - 120 && last.length > 1) last.pop();
    const hidden = left + (shown[shown.length - 1].length - last.length);
    shown = [...shown.slice(0, -1), [...last, `…and ${hidden} more: [see the Transactions tab](${more})`]];
  }
  return shown.map((p, i) => ({
    embeds: [{ title: shown.length > 1 ? `${title} (${i + 1}/${shown.length})` : title, url: link, color, description: p.join("\n"), footer }],
  }));
}
