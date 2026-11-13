// Small presentational pieces for the market pages (no hooks; usable on server and client).
import type { Team } from "@/lib/league/types";
import { onColor } from "@/lib/league/format";
import { logoVar, teamLogo } from "@/lib/league/logos";
import { chanceText, type Checkpoint, type OutcomeState } from "@/lib/league/marketTypes";

export type TeamLite = Pick<Team, "id" | "abbr" | "city" | "name" | "primary">;

export function MiniBadge({ team, size = 26 }: { team: TeamLite | undefined; size?: number }) {
  if (!team) return <span className="team-badge tbd" style={{ width: size, height: size }} aria-hidden>?</span>;
  const logo = teamLogo(team as Team);
  return (
    <span className={`team-badge${logo ? " has-logo" : ""}`} style={{ background: team.primary, color: onColor(team.primary), width: size, height: size, fontSize: size * 0.36, ...logoVar(logo) }} aria-hidden>
      {team.abbr}
    </span>
  );
}

/** "+4" / "−3" change in percentage points, or nothing when it hasn't moved. */
export function Delta({ p, prev, state }: { p: number; prev: number | null; state: OutcomeState }) {
  if (prev == null || state !== "open") return null;
  const d = Math.round(p * 100) - Math.round(prev * 100);
  if (!d) return null;
  return <span className={`mk-delta ${d > 0 ? "up" : "down"}`}>{d > 0 ? "▲" : "▼"}{Math.abs(d)}</span>;
}

export function Chance({ p, state }: { p: number; state: OutcomeState }) {
  return <span className={`mk-chance ${state}`}>{chanceText(p, state)}</span>;
}

export function Spark({ values, w = 120, h = 34 }: { values: (number | null)[]; w?: number; h?: number }) {
  const pts = values.map((v, i) => [i, v] as const).filter((x): x is readonly [number, number] => x[1] != null);
  if (pts.length < 2) return null;
  const n = values.length - 1 || 1;
  const xy = pts.map(([i, v]) => `${((i / n) * w).toFixed(1)},${(h - 2 - v * (h - 4)).toFixed(1)}`);
  const up = pts[pts.length - 1][1] >= pts[0][1];
  return (
    <svg className={`mk-spark ${up ? "up" : "down"}`} viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden>
      <polyline points={xy.join(" ")} fill="none" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export const CHART_COLORS = ["#3e8bff", "#2fd69c", "#ffb547", "#ff5fa2", "#b18cff"];

/** Price history chart: chance of each outcome at each finished week. */
export function PriceChart({ series, checkpoints }: { series: { label: string; values: (number | null)[]; color: string }[]; checkpoints: Checkpoint[] }) {
  const W = 720, H = 260, L = 8, R = 44, T = 12, B = 26;
  const n = Math.max(1, checkpoints.length - 1);
  const x = (i: number) => L + (i / n) * (W - L - R);
  const y = (v: number) => T + (1 - v) * (H - T - B);
  const every = Math.max(1, Math.ceil(checkpoints.length / 8));
  return (
    <svg className="mk-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Chance over the season">
      {[0, 0.25, 0.5, 0.75, 1].map((g) => (
        <g key={g}>
          <line x1={L} x2={W - R} y1={y(g)} y2={y(g)} className="grid" />
          <text x={W - R + 6} y={y(g) + 4} className="axis">{Math.round(g * 100)}%</text>
        </g>
      ))}
      {checkpoints.map((c, i) => (i % every === 0 || i === checkpoints.length - 1) && (
        <text key={c.label + i} x={x(i)} y={H - 6} className="axis" textAnchor={i === 0 ? "start" : i === checkpoints.length - 1 ? "end" : "middle"}>{c.label}</text>
      ))}
      {series.map((s) => {
        const pts = s.values.map((v, i) => (v == null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`)).filter(Boolean);
        const lastI = s.values.length - 1;
        const last = s.values[lastI];
        return (
          <g key={s.label}>
            <polyline points={pts.join(" ")} fill="none" stroke={s.color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
            {last != null && <circle cx={x(lastI)} cy={y(last)} r="4" fill={s.color} />}
          </g>
        );
      })}
    </svg>
  );
}
