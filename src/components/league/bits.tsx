import Link from "next/link";
import type { Game, Player, Team } from "@/lib/league/types";
import { DEV_LABEL } from "@/lib/league/types";
import { onColor } from "@/lib/league/format";
import { record } from "@/lib/league/derive";

export function TeamBadge({ team, size = 28 }: { team: Team | undefined; size?: number }) {
  if (!team) return <span className="team-badge tbd" style={{ width: size, height: size }}>?</span>;
  return (
    <span className="team-badge" style={{ background: team.primary, color: onColor(team.primary), width: size, height: size, fontSize: size * 0.36 }} aria-hidden>
      {team.abbr}
    </span>
  );
}

export function TeamLink({ slug, team, showRecord = false }: { slug: string; team: Team | undefined; showRecord?: boolean }) {
  if (!team) return <span className="team-link">TBD</span>;
  return (
    <Link className="team-link" href={`/l/${slug}/teams/${team.abbr.toLowerCase()}`}>
      <TeamBadge team={team} size={24} />
      <span>{team.city} {team.name}</span>
      {showRecord && <span className="muted">{record(team)}</span>}
    </Link>
  );
}

export function PlayerLink({ slug, player }: { slug: string; player: Player | undefined }) {
  if (!player) return <span>Unknown</span>;
  return <Link href={`/l/${slug}/players/${player.id}`}>{player.first[0]}. {player.last}</Link>;
}

export function DevTag({ dev }: { dev: number }) {
  if (!dev) return null;
  return <span className={`dev dev-${dev}`} title={DEV_LABEL[dev]}>{DEV_LABEL[dev]}</span>;
}

export function GameCard({ slug, game, teams }: { slug: string; game: Game; teams: Map<number, Team> }) {
  const home = teams.get(game.home), away = teams.get(game.away);
  const winner = game.final ? (game.hs > game.as ? game.home : game.as > game.hs ? game.away : 0) : 0;
  const row = (t: Team | undefined, id: number, score: number) => (
    <div className={`gc-row ${game.final && winner && winner !== id ? "lost" : ""}`}>
      <TeamBadge team={t} size={26} />
      <span className="gc-name">{t ? t.name : "TBD"}</span>
      {t && <span className="gc-rec">{record(t)}</span>}
      <span className="gc-score">{game.final ? score : ""}</span>
    </div>
  );
  const body = (
    <>
      {row(away, game.away, game.as)}
      {row(home, game.home, game.hs)}
      <div className="gc-foot">
        <span>{game.final ? "Final" : "Not played yet"}</span>
        {game.simmed === true && <span className="tag">Simmed</span>}
        {game.simmed === false && <span className="tag">Played</span>}
        {game.gotw && <span className="tag">Game of the week</span>}
        {(home?.user || away?.user) && <span className="muted gc-users">{away?.user || "CPU"} at {home?.user || "CPU"}</span>}
      </div>
    </>
  );
  return game.final ? (
    <Link className="game-card" href={`/l/${slug}/games/${game.id}`} aria-label={`${away?.name ?? "TBD"} at ${home?.name ?? "TBD"}, box score`}>{body}</Link>
  ) : (
    <div className="game-card">{body}</div>
  );
}

export function NoData() {
  return (
    <main className="page">
      <div className="wrap narrow">
        <div className="panel">
          <h2>Waiting for the first sync</h2>
          <p>CFM Manager checks EA every 3 hours. Once the first pull finishes, this league&apos;s standings, scores, rosters and cap sheets show up here.</p>
        </div>
      </div>
    </main>
  );
}
