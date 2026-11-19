import type { Metadata } from "next";
import Link from "next/link";
import { getLeagueData } from "@/lib/league/load";
import { weekTitle } from "@/lib/league/derive";
import { awardChoices, awardDefs, marketBook } from "@/lib/league/markets";
import { leagueBySlug, discordOf } from "@/lib/discord/links";
import { betCaps, closeTimes, economyOf, fmtET, isCommissioner, ledgerRows, viewer } from "@/lib/marketStore";
import { discordOfUser, ticketsConfig, type TicketsSetting } from "@/lib/tickets";
import { AdminPanel, type AdminData } from "@/components/league/AdminPanel";
import { listGameWeeks, readGameChannels } from "@/lib/discord/gameChannels";

export const metadata: Metadata = { title: "Admin" };
type Props = { params: Promise<{ slug: string }> };

// League admin panel (Nick, 2026-11-14: "an admin panel on the site with all the commands").
// Everything the Discord admin commands do, for the league's commissioner or owner.
export default async function AdminPage({ params }: Props) {
  const { slug } = await params;
  const [v, d, lg] = await Promise.all([viewer(slug), getLeagueData(slug), leagueBySlug(slug)]);
  const commish = Boolean(v.leagueId && v.userId && (await isCommissioner(v.leagueId, v.userId).catch(() => false)));
  if (!commish || !d || !v.leagueId || !lg) {
    return (
      <main className="page league-page"><div className="wrap">
        <h2>Admin</h2>
        <p className="muted">{!v.userId ? "Sign in to see this page." : "Only the league's commissioner can use the admin panel."}</p>
      </div></main>
    );
  }
  const cfg = await ticketsConfig(slug).catch(() => null);
  const tickets = Boolean(cfg);
  const teams = new Map(d.teams.map((t) => [t.id, t.abbr]));
  const name = (g: (typeof d.games)[number]) => `${teams.get(g.away) ?? "?"} @ ${teams.get(g.home) ?? "?"}`;
  const [caps, eco, closes, unapplied] = await Promise.all([
    betCaps(v.leagueId, tickets), economyOf(v.leagueId), closeTimes(v.leagueId, d.season.year),
    tickets ? ledgerRows(v.leagueId, { unapplied: true }) : Promise.resolve([]),
  ]);
  // members owed / owing, newest report first
  const byUser = new Map<string, { userId: string; name: string; net: number; ids: number[]; lines: string[] }>();
  for (const r of unapplied) {
    const u = byUser.get(r.userId) || { userId: r.userId, name: r.user, net: 0, ids: [], lines: [] };
    u.net += r.amount; u.ids.push(r.id); u.lines.push(`${r.amount >= 0 ? "+" : "−"}${Math.round(Math.abs(r.amount)).toLocaleString("en-US")} · ${r.note || r.kind}`);
    byUser.set(r.userId, u);
  }
  const owed = await Promise.all([...byUser.values()].map(async (u) => ({ ...u, net: Math.round(u.net), discord: (await discordOfUser(u.userId).catch(() => null))?.id ?? null })));
  const week = d.games.filter((g) => g.stage === d.season.stage && g.week === d.season.week && g.home && g.away);
  const finals = d.games.filter((g) => g.final && g.home && g.away).sort((a, b) => b.week - a.week || b.id - a.id).slice(0, 24);
  const own = (lg.settings?.tickets || null) as TicketsSetting | null;
  const guild = discordOf(lg);
  const mc = lg.settings?.marketChannels as { categoryId?: string } | undefined;
  const gcWeeks = listGameWeeks(readGameChannels(lg.settings?.gameChannels));

  // Madden's award winners (entered here; EA's export doesn't include them)
  const book = marketBook(d);
  const awardList = [...awardDefs(d).map((a) => ({ key: a.key, title: a.fullTitle, pos: a.cat === "posawards" })), { key: "award-coy", title: "Coach of the Year", pos: false }]
    .sort((a, b) => Number(a.pos) - Number(b.pos) || (a.key === "award-mvp" ? -1 : b.key === "award-mvp" ? 1 : 0) || (a.key === "award-coy" ? -1 : b.key === "award-coy" ? 1 : 0));
  const awards = awardList.map((a) => {
    const choices = awardChoices(d, book, a.key);
    const winner = d.awardResults?.[a.key] ?? null;
    if (winner && !choices.some((c) => c.id === winner)) {
      const p = d.players.find((x) => String(x.id) === winner), t = d.teams.find((x) => String(x.id) === winner);
      choices.unshift({ id: winner, label: a.key === "award-coy" ? (t ? `${t.city} ${t.name}` : winner) : p ? `${p.first} ${p.last} · ${p.pos}` : winner });
    }
    return { ...a, winner, choices };
  });

  const data: AdminData = {
    awards, awardsOpen: d.games.some((g) => g.stage === 1 && g.week <= 17 && g.home && g.away && !g.final),
    slug, tickets, field: cfg?.field ?? own?.field ?? "cash",
    caps, eco,
    owed: owed.filter((u) => u.net !== 0 || u.ids.length).sort((a, b) => a.name.localeCompare(b.name)),
    week: week.map((g) => ({ id: g.id, name: name(g), kickoff: closes.get(g.id)?.closeAt ?? null, kickoffText: closes.get(g.id) ? fmtET(closes.get(g.id)!.closeAt) : null, final: Boolean(g.final) })),
    finals: finals.map((g) => ({ id: g.id, name: `${name(g)} · ${weekTitle(d, g.stage, g.week)}`, kickoffText: closes.get(g.id) ? `${closes.get(g.id)!.kind === "verified" ? "verified" : "listed"} ${fmtET(closes.get(g.id)!.closeAt)}` : "no kickoff on record" })),
    discord: { linked: Boolean(guild), markets: Boolean(mc?.categoryId), games: gcWeeks.length > 0, gameWeeks: gcWeeks },
    seasonTitle: `${d.season.year} ${d.season.title}`,
  };
  return (
    <main className="page league-page markets-page">
      <div className="wrap">
        <h2>Admin</h2>
        <p className="muted">Everything the Discord admin commands do, for the commissioner. Changes apply to the site and Discord straight away. <Link href={`/l/${slug}/admin/audit`}>Rule audits</Link> · <Link href={`/l/${slug}/markets/setup`}>Setup guide</Link> · <Link href={`/l/${slug}/markets/activity`}>Trade log</Link></p>
        <AdminPanel data={data} />
      </div>
    </main>
  );
}
