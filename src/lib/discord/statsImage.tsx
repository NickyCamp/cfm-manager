// /stats as a picture (Nick, 2026-11-13: "chart it like /tws"): the top 10 in one category as
// horizontal bars, longest for the leader, in each player's team color. Satori (next/og).
import { ImageResponse } from "next/og";
import type { LeagueData, Team } from "../league/types";
import { cardFonts } from "./cardImage";
import { Badge, logoOf } from "./matchupImage";
import { statLeaders, teamStatLeaders, type StatCat } from "./stats";

const W = 1000, ROW = 66;
const BG = "#070a14", PANEL = "#0d1324", LINE = "#222a44", INK = "#eceff8", SOFT = "#8a93b2";
const MEDAL = ["#ffd54a", "#d7deea", "#d08a4a"]; // gold, silver, bronze rank chips

export async function renderStats(d: LeagueData, cat: StatCat, team: Team | undefined, leagueName: string) {
  const { rows, total } = statLeaders(d, cat, team?.id);
  const teams = new Map(d.teams.map((t) => [t.id, t]));
  const used = [...new Set(rows.map((r) => r.team))].map((id) => teams.get(id)).filter((t): t is Team => Boolean(t));
  if (team && !used.includes(team)) used.push(team);
  const logos = new Map(await Promise.all(used.map(async (t) => [t.id, await logoOf(t)] as const)));
  const top = Math.max(...rows.map((r) => r.raw), 1);
  const BAR = 430;
  const height = 132 + Math.max(1, rows.length) * ROW + 56;
  const node = (
    <div style={{ width: W, height, display: "flex", flexDirection: "column", backgroundColor: BG, color: INK, fontFamily: "Barlow Condensed" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 18, padding: "24px 32px", borderBottom: `2px solid ${LINE}`,
        backgroundImage: team ? `linear-gradient(90deg, ${team.primary}66, ${PANEL} 55%)` : `linear-gradient(90deg, #7a5cff33, ${PANEL} 55%)` }}>
        {team && <Badge t={team} logo={logos.get(team.id)} size={78} />}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ fontSize: 22, fontWeight: 700, color: SOFT, textTransform: "uppercase", letterSpacing: 1 }}>{team ? `${team.city} ${team.name} leaders` : `${leagueName} leaders`}</span>
          <span style={{ fontSize: 50, fontWeight: 800, lineHeight: 1, textTransform: "uppercase" }}>{cat.label}</span>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", padding: "8px 32px 0" }}>
        {rows.length === 0 && <span style={{ display: "flex", padding: "24px 0", fontSize: 26, color: SOFT }}>Nobody has a stat in this category yet.</span>}
        {rows.map((r) => {
          const t = teams.get(r.team);
          const p = r.player;
          const len = Math.max(10, Math.round((r.raw / top) * BAR));
          return (
            <div key={`${p?.id}-${r.rank}`} style={{ display: "flex", alignItems: "center", height: ROW, borderBottom: `1px solid ${LINE}` }}>
              <div style={{ width: 44, height: 44, borderRadius: 22, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, fontWeight: 800,
                backgroundColor: MEDAL[r.rank - 1] || "rgba(255,255,255,.07)", color: r.rank <= 3 ? "#1a1406" : INK }}>{r.rank}</div>
              <div style={{ width: 62, display: "flex", justifyContent: "center" }}>{t && <Badge t={t} logo={logos.get(t.id)} size={42} />}</div>
              <div style={{ width: 250, display: "flex", flexDirection: "column" }}>
                <span style={{ fontSize: 27, fontWeight: 800, lineHeight: 1.05, whiteSpace: "nowrap", overflow: "hidden" }}>{p ? `${p.first[0]}. ${p.last}` : "Unknown"}</span>
                <span style={{ fontSize: 18, fontWeight: 700, color: SOFT }}>{`${p?.pos ?? ""}${t ? ` · ${t.abbr}` : ""}${p ? ` · ${p.ovr} OVR` : ""}`}</span>
              </div>
              <div style={{ width: BAR, height: 22, display: "flex", alignItems: "center" }}>
                <div style={{ width: len, height: 22, borderRadius: 6, backgroundImage: `linear-gradient(90deg, ${t?.primary || "#3e8bff"}, ${t?.secondary || "#7a5cff"})`, border: "1px solid rgba(255,255,255,.22)" }} />
              </div>
              <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
                <span style={{ fontSize: 34, fontWeight: 800, lineHeight: 1 }}>{r.value}</span>
                {r.detail && <span style={{ fontSize: 17, fontWeight: 700, color: SOFT }}>{r.detail}</span>}
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", marginTop: "auto", padding: "12px 32px 18px", fontSize: 18, fontWeight: 700, color: SOFT }}>
        {`${leagueName} · ${d.season.year} regular season${cat.minNote ? ` · minimum ${cat.minNote}` : ""}${total > rows.length ? ` · ${total} players qualify` : ""}`}
      </div>
    </div>
  );
  return new ImageResponse(node, { width: W, height, fonts: await cardFonts(), headers: { "cache-control": "public, max-age=600, s-maxage=3600" } });
}

/** /stats by:Teams: every team ranked in one category (the team box, if given, is highlighted). */
export async function renderTeamStats(d: LeagueData, cat: StatCat, mark: Team | undefined, leagueName: string) {
  const rows = teamStatLeaders(d, cat);
  const teams = new Map(d.teams.map((t) => [t.id, t]));
  const logos = new Map(await Promise.all(d.teams.map(async (t) => [t.id, await logoOf(t)] as const)));
  const top = Math.max(...rows.map((r) => r.raw), 1);
  const R = 52, BAR = 400;
  const height = 132 + Math.max(1, rows.length) * R + 56;
  const node = (
    <div style={{ width: W, height, display: "flex", flexDirection: "column", backgroundColor: BG, color: INK, fontFamily: "Barlow Condensed" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 18, padding: "24px 32px", borderBottom: `2px solid ${LINE}`,
        backgroundImage: `linear-gradient(90deg, #7a5cff33, ${PANEL} 55%)` }}>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ fontSize: 22, fontWeight: 700, color: SOFT, textTransform: "uppercase", letterSpacing: 1 }}>{`${leagueName} team leaders`}</span>
          <span style={{ fontSize: 50, fontWeight: 800, lineHeight: 1, textTransform: "uppercase" }}>{cat.label}</span>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", padding: "4px 32px 0" }}>
        {rows.map((r) => {
          const t = teams.get(r.team);
          const on = mark?.id === r.team;
          const len = r.raw > 0 ? Math.max(8, Math.round((r.raw / top) * BAR)) : 0;
          return (
            <div key={r.team} style={{ display: "flex", alignItems: "center", height: R, borderBottom: `1px solid ${LINE}`,
              backgroundColor: on ? "rgba(122,92,255,.18)" : "transparent" }}>
              {/* Accent bar for the highlighted team. A mixed per-side border (borderLeft + borderBottom) made Satori take ~6 s for 32 rows, too slow for Discord. */}
              <div style={{ width: 4, height: R - 14, marginRight: 6, borderRadius: 2, backgroundColor: on ? t?.primary || "#7a5cff" : "transparent" }} />
              <div style={{ width: 38, height: 38, borderRadius: 19, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 21, fontWeight: 800,
                backgroundColor: MEDAL[r.rank - 1] || "rgba(255,255,255,.07)", color: r.rank <= 3 ? "#1a1406" : INK }}>{r.rank}</div>
              <div style={{ width: 56, display: "flex", justifyContent: "center" }}>{t && <Badge t={t} logo={logos.get(t.id)} size={36} />}</div>
              <div style={{ width: 250, display: "flex", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontSize: 26, fontWeight: 800, whiteSpace: "nowrap" }}>{t ? t.name : "Unknown"}</span>
                {t && <span style={{ fontSize: 17, fontWeight: 700, color: SOFT }}>{`${t.rec.w}-${t.rec.l}${t.rec.t ? `-${t.rec.t}` : ""}`}</span>}
              </div>
              <div style={{ width: BAR, height: 20, display: "flex", alignItems: "center" }}>
                {len > 0 && <div style={{ width: len, height: 20, borderRadius: 6, backgroundImage: `linear-gradient(90deg, ${t?.primary || "#3e8bff"}, ${t?.secondary || "#7a5cff"})`, border: "1px solid rgba(255,255,255,.22)" }} />}
              </div>
              <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
                <span style={{ fontSize: 28, fontWeight: 800, lineHeight: 1 }}>{r.value}</span>
                <span style={{ fontSize: 15, fontWeight: 700, color: SOFT, whiteSpace: "nowrap" }}>{r.detail}</span>
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", marginTop: "auto", padding: "12px 32px 18px", fontSize: 18, fontWeight: 700, color: SOFT }}>
        {`${leagueName} · ${d.season.year} regular season · team totals (rate stats are the team's own rate)`}
      </div>
    </div>
  );
  return new ImageResponse(node, { width: W, height, fonts: await cardFonts(), headers: { "cache-control": "public, max-age=600, s-maxage=3600" } });
}
