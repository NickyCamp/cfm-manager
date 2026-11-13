// /tws as a picture (Nick, 2026-11-13: "a chart instead of a wall of text").
// Unplayed game: the matchup chart (each offense vs the other defense, bars by league rank),
// the same chart as the site's game page (MatchupChart.tsx). Finished game: the scoreboard,
// team stats as split bars, and each team's leaders. Satori (next/og): flexbox and inline styles only.
import { ImageResponse } from "next/og";
import type { Game, LeagueData, Team } from "../league/types";
import { record, weekTitle } from "../league/derive";
import { teamLogo } from "../league/logos";
import { cardFonts, withLogo } from "./cardImage";
import { gameLeaders, matchupSides, rankBar, type MatchSide } from "./matchup";

const W = 1000;
const BG = "#070a14", PANEL = "#0d1324", LINE = "#222a44", INK = "#eceff8", SOFT = "#8a93b2", GOLD = "#ffd54a";

export async function logoOf(t: Team) {
  return (await withLogo({ teamLogo: teamLogo(t) })).teamLogo;
}

export function Badge({ t, logo, size }: { t: Team; logo?: string; size: number }) {
  if (logo) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={logo} width={size} height={size} alt="" style={{ width: size, height: size, objectFit: "contain" }} />;
  }
  return (
    <div style={{ width: size, height: size, borderRadius: size, display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: t.primary, border: `${Math.round(size / 14)}px solid ${t.secondary}`, color: "#fff", fontSize: size * 0.34, fontWeight: 800 }}>{t.abbr}</div>
  );
}

function Header({ d, g, away, home, logos, final }: { d: LeagueData; g: Game; away: Team; home: Team; logos: (string | undefined)[]; final: boolean }) {
  const team = (t: Team, logo: string | undefined, score: number, right: boolean, won: boolean) => (
    <div style={{ display: "flex", alignItems: "center", gap: 18, flexDirection: right ? "row-reverse" : "row", flex: 1 }}>
      <Badge t={t} logo={logo} size={92} />
      <div style={{ display: "flex", flexDirection: "column", alignItems: right ? "flex-end" : "flex-start" }}>
        <span style={{ fontSize: 22, fontWeight: 700, color: SOFT, textTransform: "uppercase", letterSpacing: 1 }}>{t.city}</span>
        <span style={{ fontSize: 44, fontWeight: 800, lineHeight: 1, textTransform: "uppercase" }}>{t.name}</span>
        <span style={{ fontSize: 20, fontWeight: 700, color: SOFT, marginTop: 4 }}>{`${record(t)} · ${t.user || "CPU"}`}</span>
      </div>
      {final && <span style={{ fontSize: 72, fontWeight: 800, marginLeft: right ? 0 : "auto", marginRight: right ? "auto" : 0, color: won ? INK : SOFT }}>{score}</span>}
    </div>
  );
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 20, padding: "26px 32px", backgroundImage: `linear-gradient(90deg, ${away.primary}55, ${PANEL} 40%, ${PANEL} 60%, ${home.primary}55)`, borderBottom: `2px solid ${LINE}` }}>
      {team(away, logos[0], g.as, false, g.as > g.hs)}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 150 }}>
        <span style={{ fontSize: 20, fontWeight: 800, color: SOFT, textTransform: "uppercase", letterSpacing: 1, textAlign: "center" }}>{weekTitle(d, g.stage, g.week)}</span>
        <span style={{ fontSize: 34, fontWeight: 800, color: final ? GOLD : INK }}>{final ? "FINAL" : "@"}</span>
        {g.simmed === true && final && <span style={{ fontSize: 16, fontWeight: 700, color: SOFT }}>SIMMED</span>}
      </div>
      {team(home, logos[1], g.hs, true, g.hs > g.as)}
    </div>
  );
}

/** The 10+ rank edge marker (an SVG triangle: the bundled fonts have no ▲ glyph). */
const Edge = () => (
  <svg width="16" height="14" viewBox="0 0 16 14" style={{ marginRight: 2 }}><polygon points="8,0 16,14 0,14" fill={GOLD} /></svg>
);

function SideChart({ s, n }: { s: MatchSide; n: number }) {
  const BAR = 250;
  return (
    <div style={{ display: "flex", flexDirection: "column", padding: "16px 32px 6px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, fontSize: 24, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.6 }}>
        <span style={{ color: INK }}>{`${s.off.abbr} offense`}</span>
        <span style={{ fontSize: 18, color: SOFT }}>vs</span>
        <span style={{ color: INK }}>{`${s.def.abbr} defense`}</span>
      </div>
      {s.rows.map((r) => (
        <div key={r.label} style={{ display: "flex", alignItems: "center", height: 38, borderRadius: 8, paddingLeft: 6, paddingRight: 6, backgroundColor: r.edge ? "rgba(255,213,74,.08)" : "transparent" }}>
          <div style={{ width: 120, display: "flex", alignItems: "baseline", gap: 6 }}>
            {r.edge === "off" && <Edge />}
            <span style={{ fontSize: 26, fontWeight: 800 }}>{r.off.v}</span>
            <span style={{ fontSize: 17, fontWeight: 700, color: SOFT }}>{`#${r.off.rank}`}</span>
          </div>
          <div style={{ width: BAR, height: 14, borderRadius: 7, backgroundColor: "rgba(255,255,255,.06)", display: "flex", justifyContent: "flex-end" }}>
            <div style={{ width: Math.round(rankBar(r.off.rank, n) * BAR), height: 14, borderRadius: 7, backgroundColor: s.off.primary, border: "1px solid rgba(255,255,255,.2)" }} />
          </div>
          <span style={{ width: 176, textAlign: "center", display: "flex", justifyContent: "center", fontSize: 19, fontWeight: 700, color: SOFT, textTransform: "uppercase", letterSpacing: 0.4 }}>{r.label}</span>
          <div style={{ width: BAR, height: 14, borderRadius: 7, backgroundColor: "rgba(255,255,255,.06)", display: "flex" }}>
            <div style={{ width: Math.round(rankBar(r.def.rank, n) * BAR), height: 14, borderRadius: 7, backgroundColor: s.def.primary, border: "1px solid rgba(255,255,255,.2)" }} />
          </div>
          <div style={{ width: 120, display: "flex", alignItems: "baseline", justifyContent: "flex-end", gap: 6 }}>
            <span style={{ fontSize: 17, fontWeight: 700, color: SOFT }}>{`#${r.def.rank}`}</span>
            <span style={{ fontSize: 26, fontWeight: 800 }}>{r.def.v}</span>
            {r.edge === "def" && <Edge />}
          </div>
        </div>
      ))}
    </div>
  );
}

function BoxBars({ d, g, away, home }: { d: LeagueData; g: Game; away: Team; home: Team }) {
  const a = d.teamGames.find((r) => r.g === g.id && r.t === away.id), h = d.teamGames.find((r) => r.g === g.id && r.t === home.id);
  if (!a || !h) return <div style={{ display: "flex", padding: "24px 32px", fontSize: 22, color: SOFT }}>No team stats for this game.</div>;
  const rows: [string, number, number, string, string][] = [
    ["Total yards", a.yds, h.yds, String(a.yds), String(h.yds)],
    ["Passing", a.passYds, h.passYds, String(a.passYds), String(h.passYds)],
    ["Rushing", a.rushYds, h.rushYds, String(a.rushYds), String(h.rushYds)],
    ["First downs", a.firstDowns, h.firstDowns, String(a.firstDowns), String(h.firstDowns)],
    ["3rd down", a.third[0], h.third[0], `${a.third[0]}/${a.third[1]}`, `${h.third[0]}/${h.third[1]}`],
    ["Red zone TDs", a.redZone[0], h.redZone[0], `${a.redZone[0]}/${a.redZone[1]}`, `${h.redZone[0]}/${h.redZone[1]}`],
    ["Turnovers", a.turnovers, h.turnovers, String(a.turnovers), String(h.turnovers)],
    ["Sacks made", a.sacks, h.sacks, String(a.sacks), String(h.sacks)],
    ["Penalties", a.penalties, h.penalties, `${a.penalties}-${a.penaltyYds}`, `${h.penalties}-${h.penaltyYds}`],
  ];
  const BAR = 290;
  return (
    <div style={{ display: "flex", flexDirection: "column", padding: "18px 32px 8px" }}>
      {rows.map(([label, x, y, xs, ys]) => {
        const tot = x + y || 1;
        return (
          <div key={label} style={{ display: "flex", alignItems: "center", height: 40 }}>
            <span style={{ width: 90, fontSize: 26, fontWeight: 800, display: "flex" }}>{xs}</span>
            <div style={{ width: BAR, height: 14, borderRadius: 7, backgroundColor: "rgba(255,255,255,.06)", display: "flex", justifyContent: "flex-end" }}>
              <div style={{ width: Math.max(4, Math.round((x / tot) * BAR)), height: 14, borderRadius: 7, backgroundColor: away.primary, border: "1px solid rgba(255,255,255,.2)" }} />
            </div>
            <span style={{ width: 176, display: "flex", justifyContent: "center", fontSize: 19, fontWeight: 700, color: SOFT, textTransform: "uppercase", letterSpacing: 0.4 }}>{label}</span>
            <div style={{ width: BAR, height: 14, borderRadius: 7, backgroundColor: "rgba(255,255,255,.06)", display: "flex" }}>
              <div style={{ width: Math.max(4, Math.round((y / tot) * BAR)), height: 14, borderRadius: 7, backgroundColor: home.primary, border: "1px solid rgba(255,255,255,.2)" }} />
            </div>
            <span style={{ width: 90, fontSize: 26, fontWeight: 800, display: "flex", justifyContent: "flex-end" }}>{ys}</span>
          </div>
        );
      })}
    </div>
  );
}

function Leaders({ d, g, away, home }: { d: LeagueData; g: Game; away: Team; home: Team }) {
  const col = (t: Team) => (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6, padding: "14px 18px", backgroundColor: PANEL, borderRadius: 12, border: `1px solid ${LINE}`, borderTop: `4px solid ${t.primary}` }}>
      <span style={{ fontSize: 20, fontWeight: 800, color: SOFT, textTransform: "uppercase", letterSpacing: 1 }}>{`${t.abbr} leaders`}</span>
      {gameLeaders(d, g, t).split("\n").map((line) => {
        const [who, ...rest] = line.split(": ");
        return (
          <div key={line} style={{ display: "flex", flexDirection: "column" }}>
            <span style={{ fontSize: 22, fontWeight: 800 }}>{who}</span>
            <span style={{ fontSize: 19, fontWeight: 700, color: SOFT }}>{rest.join(": ")}</span>
          </div>
        );
      })}
    </div>
  );
  return <div style={{ display: "flex", gap: 16, padding: "10px 32px 24px" }}>{col(away)}{col(home)}</div>;
}

/** The /tws picture for a game. */
export async function renderMatchup(d: LeagueData, g: Game, away: Team, home: Team, leagueName: string) {
  const logos = await Promise.all([logoOf(away), logoOf(home)]);
  const m = g.final ? null : matchupSides(d, away, home);
  const height = g.final ? 150 + 9 * 40 + 26 + 230 + 50 : m ? 150 + 2 * (60 + 8 * 38) + 18 + 70 : 150 + 120;
  const node = (
    <div style={{ width: W, height, display: "flex", flexDirection: "column", backgroundColor: BG, color: INK, fontFamily: "Barlow Condensed" }}>
      <Header d={d} g={g} away={away} home={home} logos={logos} final={g.final} />
      {/* Satori drops fragments, so each branch is one flex column. */}
      {g.final ? (
        <div style={{ display: "flex", flexDirection: "column" }}>
          <BoxBars d={d} g={g} away={away} home={home} />
          <Leaders d={d} g={g} away={away} home={home} />
        </div>
      ) : m ? (
        <div style={{ display: "flex", flexDirection: "column" }}>
          <SideChart s={m.sides[0]} n={d.teams.length} />
          <div style={{ display: "flex", height: 2, margin: "8px 32px 0", backgroundColor: LINE }} />
          <SideChart s={m.sides[1]} n={d.teams.length} />
        </div>
      ) : (
        <div style={{ display: "flex", padding: "40px 32px", fontSize: 26, color: SOFT }}>The matchup chart shows up once both teams have played this season.</div>
      )}
      <div style={{ display: "flex", marginTop: "auto", padding: "10px 32px 16px", fontSize: 17, fontWeight: 700, color: SOFT }}>
        {g.final
          ? `${leagueName} · ${d.season.year}`
          : `${leagueName} · per game, ${d.season.year} season · bars = league rank (#1 longest) · gold rows: a 10+ rank edge · turnovers/sacks: given up/allowed on offense, forced/made on defense`}
      </div>
    </div>
  );
  return new ImageResponse(node, { width: W, height, fonts: await cardFonts(), headers: { "cache-control": "public, max-age=600, s-maxage=600" } });
}
