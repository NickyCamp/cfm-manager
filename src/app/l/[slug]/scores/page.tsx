import type { Metadata } from "next";
import Link from "next/link";
import { getLeagueData } from "@/lib/league/load";
import { defaultScoresWeek, gamesForWeek, indexes, parseWeekKey, weekKey, weekTitle, weeksWithGames } from "@/lib/league/derive";
import { GameCard, NoData } from "@/components/league/bits";
import { ScrollCurrentIntoView } from "@/components/league/ScrollCurrentIntoView";

export const metadata: Metadata = { title: "Scores" };
type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ week?: string }> };

export default async function Scores({ params, searchParams }: Props) {
  const { slug } = await params;
  const { week } = await searchParams;
  const d = await getLeagueData(slug);
  if (!d) return <NoData />;

  const { teams } = indexes(d);
  const pick = parseWeekKey(week) || defaultScoresWeek(d);
  const all = weeksWithGames(d);
  const idx = all.findIndex((w) => w.stage === pick.stage && w.week === pick.week);
  const prev = idx > 0 ? all[idx - 1] : null, next = idx >= 0 && idx < all.length - 1 ? all[idx + 1] : null;
  const games = gamesForWeek(d, pick.stage, pick.week).filter((g) => g.home || g.away);
  const finals = games.filter((g) => g.final).length;

  return (
    <main className="page league-page">
      <div className="wrap">
        <div className="week-bar">
          {prev ? <Link className="btn btn-quiet sm" href={`/l/${slug}/scores?week=${weekKey(prev.stage, prev.week)}`} aria-label={`Previous: ${prev.title}`}>‹</Link> : <span />}
          <div className="week-title">
            <h2>{weekTitle(d, pick.stage, pick.week)}</h2>
            <div className="muted">{finals} of {games.length} games final</div>
          </div>
          {next ? <Link className="btn btn-quiet sm" href={`/l/${slug}/scores?week=${weekKey(next.stage, next.week)}`} aria-label={`Next: ${next.title}`}>›</Link> : <span />}
        </div>
        <nav className="week-chips" aria-label="Weeks">
          {all.map((w) => {
            const k = weekKey(w.stage, w.week);
            const on = w.stage === pick.stage && w.week === pick.week;
            const short = w.title.replace("Preseason Week ", "P").replace("Week ", "").replace(" Playoff", "").replace("Wildcard", "WC").replace("Divisional", "Div").replace("Conference", "Conf").replace("Super Bowl", "SB");
            return (
              <Link key={k} href={`/l/${slug}/scores?week=${k}`} aria-current={on ? "page" : undefined} className={w.played === 0 ? "unplayed" : ""} title={w.title}>
                {short}
              </Link>
            );
          })}
        </nav>
        <ScrollCurrentIntoView selector=".week-chips [aria-current=page]" />
        {games.length ? (
          <div className="game-grid">{games.map((g) => <GameCard key={g.id} slug={slug} game={g} teams={teams} />)}</div>
        ) : (
          <p className="muted">The matchups for this week aren&apos;t set yet.</p>
        )}
      </div>
    </main>
  );
}
