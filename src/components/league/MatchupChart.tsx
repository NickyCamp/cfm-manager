// The matchup chart on an unplayed game's page: each offense against the other defense,
// one row per stat, bars growing out from the middle by league rank (#1 = longest).
// The /tws Discord image draws the same chart (src/lib/discord/matchupImage.tsx).
import type { LeagueData, Team } from "@/lib/league/types";
import { matchupSides, rankBar, type MatchSide } from "@/lib/discord/matchup";
import { TeamBadge } from "./bits";

export function MatchupChart({ d, away, home }: { d: LeagueData; away: Team; home: Team }) {
  const m = matchupSides(d, away, home);
  if (!m) return <p className="muted">The matchup chart shows up once both teams have played this season.</p>;
  const n = d.teams.length;
  return (
    <section className="panel mu">
      <h3>Matchup <span className="muted small">per game, {d.season.year} season · #1 = best in the league</span></h3>
      {m.sides.map((s) => <Side key={s.off.id} s={s} n={n} />)}
      <p className="hint">Turnovers: given up on offense, forced on defense. Sacks: allowed on offense, made on defense. ▲ marks a 10+ rank edge.</p>
    </section>
  );
}

function Side({ s, n }: { s: MatchSide; n: number }) {
  return (
    <div className="mu-side">
      <div className="mu-head">
        <span className="mu-team"><TeamBadge team={s.off} size={26} />{s.off.abbr} offense</span>
        <span className="mu-vs">vs</span>
        <span className="mu-team right">{s.def.abbr} defense<TeamBadge team={s.def} size={26} /></span>
      </div>
      {s.rows.map((r) => (
        <div key={r.label} className={`mu-row ${r.edge ? `edge-${r.edge}` : ""}`}>
          <span className="mu-val">{r.edge === "off" && <i>▲</i>}{r.off.v} <em>#{r.off.rank}</em></span>
          <span className="mu-bar left"><span style={{ width: `${rankBar(r.off.rank, n) * 100}%`, background: s.off.primary }} /></span>
          <span className="mu-label">{r.label}</span>
          <span className="mu-bar"><span style={{ width: `${rankBar(r.def.rank, n) * 100}%`, background: s.def.primary }} /></span>
          <span className="mu-val right"><em>#{r.def.rank}</em> {r.def.v}{r.edge === "def" && <i>▲</i>}</span>
        </div>
      ))}
    </div>
  );
}
