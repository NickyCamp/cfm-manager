// Odds over time as a picture, for the weekly #market-feed post (Nick, 2026-11-13: "do the weekly").
// Same data as the market page chart: the recorded market price after every bet/sync, else the
// model's chance after each week. Satori (next/og); lines drawn as inline SVG, text as HTML.
import { ImageResponse } from "next/og";
import type { LeagueData, Team } from "../league/types";
import type { Checkpoint, Market } from "../league/marketTypes";
import type { PricePoint } from "../marketStore";
import { cardFonts } from "./cardImage";
import { Badge, logoOf } from "./matchupImage";

const W = 1000, H = 600, CW = 640, CH = 380;
const BG = "#070a14", PANEL = "#0d1324", LINE = "#222a44", INK = "#eceff8", SOFT = "#8a93b2";
const COLORS = ["#3e8bff", "#2fd69c", "#ffb547", "#ff5fa2", "#b18cff"];

export async function renderOddsChart(d: LeagueData, m: Market, points: PricePoint[], checkpoints: Checkpoint[], leagueName: string) {
  const top = m.outcomes.filter((o) => o.state !== "lost").sort((a, b) => (b.state === "won" ? 1 : 0) - (a.state === "won" ? 1 : 0) || b.p - a.p).slice(0, 5);
  const nowP = (o: (typeof top)[number]) => (o.state === "won" ? 1 : o.p);
  const live = points.length >= 2;
  // x positions 0..1 and values per outcome
  let xs: number[], series: (number | null)[][], from: string, to: string;
  if (live) {
    const ts = [...points.map((p) => Date.parse(p.at)), Date.now()];
    const t0 = ts[0], t1 = Math.max(ts[ts.length - 1], t0 + 1);
    xs = ts.map((t) => (t - t0) / (t1 - t0));
    series = top.map((o) => [...points.map((p) => p.prices[o.id] ?? null), nowP(o)]);
    const fmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
    from = fmt.format(t0); to = "Now";
  } else {
    const n = Math.max(1, checkpoints.length - 1);
    xs = checkpoints.map((_, i) => i / n);
    series = top.map((o) => o.history.map((v, i) => (i === o.history.length - 1 ? nowP(o) : v)));
    from = checkpoints[0]?.label ?? ""; to = checkpoints.at(-1)?.label ?? "";
  }
  // y axis fitted to the race: top of 20/40/60/80/100%, so grid lines land on whole numbers
  const peak = Math.max(0.01, ...series.flat().map((v) => v ?? 0));
  const ymax = Math.min(1, Math.max(0.2, Math.ceil(peak * 1.1 * 5 - 1e-9) / 5));
  const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => f * ymax);
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const X = (f: number) => 8 + f * (CW - 16), Y = (v: number) => 8 + (1 - v / ymax) * (CH - 16);
  const path = (vals: (number | null)[]) => {
    let s = "", prev: number | null = null;
    vals.forEach((v, i) => {
      if (v == null) { prev = null; return; }
      const px = X(xs[i]).toFixed(1), py = Y(v).toFixed(1);
      s += prev == null ? `M${px},${py}` : live ? `H${px}V${py}` : `L${px},${py}`;
      prev = v;
    });
    return s;
  };
  const teams = new Map(d.teams.map((t) => [t.id, t]));
  const logos = new Map<number, string | undefined>(await Promise.all(top.filter((o) => o.team != null).map(async (o) => [o.team!, await logoOf(teams.get(o.team!) as Team)] as const)));
  const node = (
    <div style={{ width: W, height: H, display: "flex", flexDirection: "column", backgroundColor: BG, color: INK, fontFamily: "Barlow Condensed" }}>
      <div style={{ display: "flex", flexDirection: "column", padding: "20px 32px 14px", borderBottom: `2px solid ${LINE}`, backgroundImage: `linear-gradient(90deg, #7a5cff33, ${PANEL} 55%)` }}>
        <span style={{ fontSize: 20, fontWeight: 700, color: SOFT, textTransform: "uppercase", letterSpacing: 1 }}>{`${leagueName} markets · odds over time`}</span>
        <span style={{ fontSize: 44, fontWeight: 800, lineHeight: 1, textTransform: "uppercase" }}>{m.title}</span>
      </div>
      <div style={{ display: "flex", padding: "22px 32px 0" }}>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", position: "relative", width: CW, height: CH, backgroundColor: PANEL, borderRadius: 10 }}>
            <svg width={CW} height={CH} viewBox={`0 0 ${CW} ${CH}`}>
              {grid.map((g) => <path key={g} d={`M8,${Y(g)}H${CW - 8}`} stroke={LINE} strokeWidth="1.5" fill="none" />)}
              {series.map((vals, i) => <path key={i} d={path(vals)} stroke={COLORS[i]} strokeWidth="4" fill="none" strokeLinejoin="round" strokeLinecap="round" />)}
              {series.map((vals, i) => { const j = vals.length - 1, v = vals[j]; return v == null ? null : <circle key={`d${i}`} cx={X(xs[j] ?? 1)} cy={Y(v)} r="7" fill={COLORS[i]} />; })}
            </svg>
            {grid.slice(1).reverse().map((g) => (
              <span key={g} style={{ position: "absolute", left: 14, top: Y(g) + 2, fontSize: 16, fontWeight: 700, color: SOFT }}>{pct(g)}</span>
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", width: CW, paddingTop: 6, fontSize: 18, fontWeight: 700, color: SOFT }}>
            <span>{from}</span><span>{to}</span>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", flex: 1, paddingLeft: 26, gap: 10 }}>
          {top.map((o, i) => {
            const t = o.team != null ? teams.get(o.team) : undefined;
            return (
              <div key={o.id} style={{ display: "flex", alignItems: "center", height: 62, borderBottom: `1px solid ${LINE}` }}>
                <div style={{ width: 8, height: 40, borderRadius: 4, backgroundColor: COLORS[i], marginRight: 12 }} />
                {t && <div style={{ display: "flex", marginRight: 10 }}><Badge t={t} logo={logos.get(t.id)} size={40} /></div>}
                <span style={{ flex: 1, fontSize: 25, fontWeight: 800, lineHeight: 1.05, whiteSpace: "nowrap", overflow: "hidden" }}>{t ? t.name : o.label}</span>
                <span style={{ fontSize: 34, fontWeight: 800 }}>{o.state === "won" ? "Won" : `${Math.round(o.p * 100)}%`}</span>
              </div>
            );
          })}
        </div>
      </div>
      <div style={{ display: "flex", marginTop: "auto", padding: "10px 32px 16px", fontSize: 18, fontWeight: 700, color: SOFT }}>
        {live ? "Market price: moves with every bet and each weekly sync" : "Model's chance after each week · market prices are tracked from here on"}
      </div>
    </div>
  );
  return new ImageResponse(node, { width: W, height: H, fonts: await cardFonts(), headers: { "cache-control": "public, max-age=600, s-maxage=600" } });
}
