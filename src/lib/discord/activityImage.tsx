// #activity-tracker-season and #activity-tracker-cycle charts (Nick, 2026-11-19), styled after the league's
// activity sheet: one row per user, sorted by miss %, the row tinted green (no misses) through red.
import { ImageResponse } from "next/og";
import type { Team } from "../league/types";
import { cardFonts } from "./cardImage";
import { Badge, logoOf } from "./matchupImage";

export type ActivityRow = { user: string; team?: Team; teamAbbr: string; played: number; missed: number; seasons?: number; perSeason?: (number | null)[] };

const BG = "#070a14", PANEL = "#0d1324", LINE = "#222a44", INK = "#eceff8", SOFT = "#8a93b2";
const ROW = 40;

/** Green at 0% misses, then yellow, orange, red (like the sheet's colour scale). */
export function missColor(pct: number): string {
  if (pct <= 0) return "#1f7a4d";
  if (pct < 0.04) return "#5f8a2c";
  if (pct < 0.07) return "#9a8a1f";
  if (pct < 0.1) return "#a8691c";
  if (pct < 0.15) return "#a8501c";
  if (pct < 0.2) return "#9a3a24";
  return "#8a2230";
}

export const missPct = (r: { played: number; missed: number }) => (r.played + r.missed ? r.missed / (r.played + r.missed) : 0);

export async function renderActivity(o: { title: string; subtitle: string; rows: ActivityRow[]; seasonLabels?: string[] }): Promise<Buffer> {
  const seasonCols = o.seasonLabels || [];
  const cycle = seasonCols.length > 0;
  const cols: [string, number][] = [["#", 46], ["", 40], ["User", 200], ["Team", 70], ["Miss %", 100], ["Games", 80],
    ...(cycle ? [["Seasons", 86] as [string, number]] : [["Played", 80] as [string, number]]), ["Misses", 84], ...seasonCols.map((l) => [l, 92] as [string, number])];
  const W = Math.max(900, cols.reduce((s, [, w]) => s + w, 0) + 64);
  const teams = [...new Map(o.rows.filter((r) => r.team).map((r) => [r.team!.id, r.team!])).values()];
  const logos = new Map(await Promise.all(teams.map(async (t) => [t.id, await logoOf(t).catch(() => undefined)] as const)));
  const height = 120 + 44 + Math.max(1, o.rows.length) * ROW + 40;
  const cell = (w: number, child: React.ReactNode, opts: { left?: boolean; bold?: boolean; color?: string } = {}) => (
    <div style={{ width: w, display: "flex", justifyContent: opts.left ? "flex-start" : "center", alignItems: "center", fontSize: 22, fontWeight: opts.bold ? 800 : 600, color: opts.color || INK, overflow: "hidden" }}>{child}</div>
  );
  const node = (
    <div style={{ width: W, height, display: "flex", flexDirection: "column", backgroundColor: BG, color: INK, fontFamily: "Barlow Condensed" }}>
      <div style={{ display: "flex", flexDirection: "column", padding: "22px 32px", borderBottom: `2px solid ${LINE}`, backgroundImage: `linear-gradient(90deg, #1f7a4d44, ${PANEL} 60%)` }}>
        <span style={{ fontSize: 20, fontWeight: 700, color: SOFT, textTransform: "uppercase", letterSpacing: 1 }}>{o.subtitle}</span>
        <span style={{ fontSize: 46, fontWeight: 800, lineHeight: 1.05, textTransform: "uppercase" }}>{o.title}</span>
      </div>
      <div style={{ display: "flex", padding: "0 32px", height: 44, alignItems: "center", borderBottom: `2px solid ${LINE}` }}>
        {cols.map(([l, w], k) => <div key={k} style={{ width: w, display: "flex", justifyContent: k === 2 ? "flex-start" : "center", fontSize: 18, fontWeight: 700, color: SOFT, textTransform: "uppercase" }}>{l}</div>)}
      </div>
      <div style={{ display: "flex", flexDirection: "column", padding: "0 32px" }}>
        {o.rows.map((r, i) => {
          const pct = missPct(r);
          const games = r.played + r.missed;
          return (
            <div key={i} style={{ display: "flex", height: ROW, alignItems: "center", borderBottom: `1px solid ${LINE}`, backgroundColor: games ? `${missColor(pct)}55` : "transparent" }}>
              {cell(46, String(i + 1), { color: SOFT })}
              {cell(40, r.team ? <Badge t={r.team} logo={logos.get(r.team.id)} size={30} /> : "")}
              {cell(200, r.user, { left: true, bold: true })}
              {cell(70, r.teamAbbr, { color: SOFT })}
              <div style={{ width: 100, display: "flex", justifyContent: "center" }}>
                <div style={{ display: "flex", padding: "2px 10px", borderRadius: 6, backgroundColor: games ? missColor(pct) : "transparent", fontSize: 22, fontWeight: 800 }}>{games ? pct.toFixed(3) : "—"}</div>
              </div>
              {cell(80, String(games))}
              {cycle ? cell(86, (r.seasons ?? 0).toFixed(1)) : cell(80, String(r.played))}
              {cell(84, String(r.missed), { bold: true })}
              {seasonCols.map((_, k) => <div key={k} style={{ display: "flex" }}>{cell(92, r.perSeason?.[k] == null ? "—" : String(r.perSeason[k]), { color: SOFT })}</div>)}
            </div>
          );
        })}
      </div>
    </div>
  );
  const img = new ImageResponse(node, { width: W, height, fonts: await cardFonts() });
  return Buffer.from(await img.arrayBuffer());
}
