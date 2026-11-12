// What changed between two builds of a league, as Discord messages. The sync
// worker posts these to the league's update channel (/notify) after each pull.
import type { LeagueData, Player, Team } from "../league/types";
import { DEV_LABEL } from "../league/types";
import { money } from "../league/format";
import { weekTitle } from "../league/derive";
import { BRAND, hexColor, type Message } from "./api";

const MAX_MOVES = 30;

export function leagueChanges(prev: LeagueData | null, next: LeagueData, leagueName: string, base: string, slug: string): Message[] {
  if (!prev) return [];
  const url = (path = "") => `${base}/l/${slug}${path}`;
  const out: Message[] = [];
  const team = (id: number) => next.teams.find((t) => t.id === id);
  const abbr = (id: number) => team(id)?.abbr || "FA";
  const footer = { text: `${leagueName} · ${next.season.year} ${next.season.title}` };

  // 1. The league advanced.
  const moved = prev.season.year !== next.season.year || prev.season.stage !== next.season.stage || prev.season.week !== next.season.week;
  if (moved) {
    out.push({ embeds: [{ color: BRAND, title: `${leagueName} advanced to ${next.season.year} ${next.season.title}`, url: url(), footer }] });
  }
  const sameYear = prev.season.year === next.season.year;

  // 2. Games that went final since the last sync.
  if (sameYear) {
    const before = new Map(prev.games.map((g) => [g.id, g]));
    const finals = next.games.filter((g) => g.final && g.home && g.away && !before.get(g.id)?.final);
    const byWeek = new Map<string, typeof finals>();
    for (const g of finals) {
      const k = weekTitle(next, g.stage, g.week);
      byWeek.set(k, [...(byWeek.get(k) || []), g]);
    }
    for (const [title, games] of byWeek) {
      const lines = games.map((g) => {
        const aw = g.as > g.hs, hw = g.hs > g.as;
        const a = `${abbr(g.away)} ${g.as}`, h = `${abbr(g.home)} ${g.hs}`;
        return `${aw ? `**${a}**` : a} @ ${hw ? `**${h}**` : h}${g.simmed ? " · sim" : ""} · [box](${url(`/games/${g.id}`)})`;
      });
      out.push({ embeds: [{ color: BRAND, title: `Final scores: ${title}`, url: url("/scores"), description: lines.join("\n"), footer }] });
    }
  }

  // 3. Roster moves (only within a season; at the new league year every deal ticks down).
  if (sameYear) {
    const before = new Map(prev.players.map((p) => [p.id, p]));
    const moves: { p: Player; line: string }[] = [];
    let drafted = 0;
    const who = (p: Player) => `**${p.first} ${p.last}** (${p.pos}, ${p.ovr}${p.dev ? ` ${DEV_LABEL[p.dev]}` : ""})`;
    const deal = (p: Player) => `${p.contract.length} yrs, ${money(p.contract.salary + p.contract.bonus)}`;
    for (const p of next.players) {
      if (p.gone) continue;
      const o = before.get(p.id);
      if (!o) {
        if (p.yearsPro === 0 && p.team) drafted++;
        else if (p.team && !p.ps) moves.push({ p, line: `✍️ ${abbr(p.team)} signed ${who(p)}: ${deal(p)}` });
        continue;
      }
      if (o.team !== p.team) {
        if (!p.team) { if (!o.ps) moves.push({ p, line: `✂️ ${abbr(o.team)} released ${who(p)}` }); }
        else if (!o.team) { if (!p.ps) moves.push({ p, line: `✍️ ${abbr(p.team)} signed ${who(p)}: ${deal(p)}` }); }
        else moves.push({ p, line: `🔁 ${who(p)} traded ${abbr(o.team)} → ${abbr(p.team)}` });
        continue;
      }
      if (!p.team || p.ps) continue;
      const c = p.contract, oc = o.contract;
      if (c.length !== oc.length || c.yearsLeft > oc.yearsLeft) moves.push({ p, line: `📝 ${abbr(p.team)} extended ${who(p)}: ${deal(p)}, ${money(c.capHit)} this year` });
      else if (c.salary !== oc.salary || c.bonus !== oc.bonus) moves.push({ p, line: `🔧 ${abbr(p.team)} restructured ${who(p)}: cap hit ${money(oc.capHit)} → ${money(c.capHit)}` });
    }
    moves.sort((a, b) => b.p.ovr - a.p.ovr);
    if (moves.length || drafted) {
      const shown = moves.slice(0, MAX_MOVES).map((m) => m.line);
      if (moves.length > MAX_MOVES) shown.push(`…and ${moves.length - MAX_MOVES} more`);
      if (drafted) shown.push(`🎓 ${drafted} rookie${drafted === 1 ? "" : "s"} drafted · [draft](${url("/draft")})`);
      out.push({ embeds: [{ color: BRAND, title: "Roster moves", url: url("/cap"), description: shown.join("\n"), footer }] });
    }
  }

  // 4. Teams that just went over the cap.
  const wasOver = new Set(prev.teams.filter((t) => t.cap.available < 0).map((t) => t.id));
  const over = next.teams.filter((t) => t.cap.available < 0 && !wasOver.has(t.id));
  for (const t of over) out.push({ embeds: [overCap(t, url, footer)] });

  return out;
}

function overCap(t: Team, url: (p?: string) => string, footer: { text: string }) {
  return {
    color: hexColor(t.primary),
    title: `⚠️ ${t.city} ${t.name} are over the cap`,
    url: url(`/teams/${t.abbr.toLowerCase()}?tab=cap`),
    description: `${money(t.cap.available)} in space${t.user ? ` · ${t.user}` : ""}`,
    footer,
  };
}
