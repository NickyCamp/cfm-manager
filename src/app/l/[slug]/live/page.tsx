import type { Metadata } from "next";
import Link from "next/link";
import { getLeagueData } from "@/lib/league/load";
import { gamesForWeek, indexes, weekTitle } from "@/lib/league/derive";
import { NoData, TeamBadge } from "@/components/league/bits";
import { LiveGrid, type LiveItem } from "@/components/league/LiveGrid";
import { RedZone } from "@/components/league/RedZone";
import { StreamLinkEditor } from "@/components/league/StreamLinkEditor";
import { CheckAgain } from "@/components/league/CheckAgain";
import { editableStreamTeams, leagueStreamLinks } from "@/lib/streamStore";
import { liveStatus, platformReady, PLATFORM_NAME, streamUrl, type Platform } from "@/lib/streams";

export const metadata: Metadata = { title: "Live" };
export const dynamic = "force-dynamic";
type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ check?: string }> };

/**
 * Live (Nick, 2026-11-22): every user streams their games. Each team's manager saves a Twitch, Kick
 * or YouTube link below; whoever is live right now is embedded at the top, matched to this week's game.
 */
export default async function Live({ params, searchParams }: Props) {
  const { slug } = await params;
  const { check } = await searchParams;
  const d = await getLeagueData(slug);
  if (!d) return <NoData />;
  const { teams } = indexes(d);
  const [links, edit] = await Promise.all([leagueStreamLinks(slug, d), editableStreamTeams(slug, d)]);
  // "Check again" (?check=…) asks the platforms fresh; a plain visit may reuse a check from the last minute
  const live = await liveStatus(slug, links, { fresh: Boolean(check) });

  // this week's game for each team, so a stream can be shown as "BUF at KC"
  const week = gamesForWeek(d, d.season.stage, d.season.week).filter((g) => g.home && g.away);
  const gameOf = new Map<number, (typeof week)[number]>();
  for (const g of week) { gameOf.set(g.home, g); gameOf.set(g.away, g); }

  const items: LiveItem[] = [];
  for (const [teamId, l] of links) {
    const info = live.get(teamId);
    const t = teams.get(teamId);
    if (!info?.live || !t) continue;
    const g = gameOf.get(teamId);
    const opp = g ? teams.get(g.home === teamId ? g.away : g.home) : undefined;
    items.push({
      teamId, abbr: t.abbr, team: `${t.city} ${t.name}`, primary: t.primary, user: t.user,
      platform: l.platform, channel: l.channel, url: streamUrl(l), videoId: info.videoId,
      title: info.title, viewers: info.viewers, startedAt: info.startedAt,
      game: g && opp ? { id: g.id, label: g.home === teamId ? `vs ${opp.abbr}` : `at ${opp.abbr}`, final: g.final } : undefined,
    });
  }
  // streams of the same game side by side, then most viewers first
  items.sort((a, b) => (a.game?.id ?? 1e12) - (b.game?.id ?? 1e12) || (b.viewers ?? 0) - (a.viewers ?? 0));

  const userTeams = d.teams.filter((t) => t.user).sort((a, b) => a.city.localeCompare(b.city));
  const missingKeys = (["twitch", "kick", "youtube"] as Platform[]).filter((p) => !platformReady(p) && [...links.values()].some((l) => l.platform === p));

  return (
    <main className="page league-page">
      <div className="wrap">
        <div className="week-title" style={{ marginBottom: 12 }}>
          <h2>Live now</h2>
          <div className="muted">{d.season.year} {weekTitle(d, d.season.stage, d.season.week)} · checked when you open this page · <CheckAgain /></div>
        </div>

        {items.length >= 2 ? <RedZone slug={slug} items={items} admin={edit.admin} /> : items.length ? <LiveGrid items={items} /> : (
          <div className="panel muted">Nobody in the league is live right now.{links.size ? "" : " Add your stream link below so your games show up here."}</div>
        )}

        {missingKeys.length > 0 && edit.admin && (
          <div className="panel small">
            <strong>Not checked yet:</strong> {missingKeys.map((p) => PLATFORM_NAME[p]).join(", ")} streams can&apos;t be checked until the site has API keys for them
            (Vercel env vars: {missingKeys.map((p) => p === "twitch" ? "TWITCH_CLIENT_ID + TWITCH_CLIENT_SECRET" : p === "kick" ? "KICK_CLIENT_ID + KICK_CLIENT_SECRET" : "YOUTUBE_API_KEY").join("; ")}).
          </div>
        )}

        <div className="panel tbl-wrap" id="links">
          <table className="tbl">
            <caption>Stream links</caption>
            <thead><tr><th>Team</th><th>Manager</th><th>Stream</th><th>Status</th></tr></thead>
            <tbody>
              {userTeams.map((t) => {
                const l = links.get(t.id);
                const info = live.get(t.id);
                const status = !l ? <span className="muted">—</span>
                  : info?.live ? <span className="live-pill">● Live</span>
                    : info?.checked ? <span className="muted">Offline</span>
                      : <span className="muted">Not checked</span>;
                return (
                  <tr key={t.id}>
                    <td><Link className="team-link" href={`/l/${slug}/teams/${t.abbr.toLowerCase()}`}><TeamBadge team={t} size={24} /><span>{t.city} {t.name}</span></Link></td>
                    <td>{t.user}</td>
                    <td>
                      {l ? <a href={streamUrl(l)} target="_blank" rel="noopener noreferrer">{PLATFORM_NAME[l.platform]}: {l.channel}</a> : <span className="muted">No link</span>}
                      {edit.teams.has(t.id) && <StreamLinkEditor slug={slug} teamId={t.id} current={l ? streamUrl(l) : ""} />}
                    </td>
                    <td>{status}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="muted small">Links work for Twitch (twitch.tv/name), Kick (kick.com/name) and YouTube (youtube.com/@handle). Only the person running a team, or a league admin, can change its link. When a team changes hands, its old link stops showing.</p>
      </div>
    </main>
  );
}
