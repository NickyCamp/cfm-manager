"use client";
import { forwardRef, useRef } from "react";
import type { Group, Player } from "@/lib/macro/layout";
import {
  findDefOption,
  findOffOption,
  roleOf,
  stuntMoves,
  zoneFor,
  ZC,
  type DefCtx,
  type DefOption,
  type OffOption,
} from "@/lib/macro/macros";
import type { Step } from "@/lib/macro/share";

// Chart geometry (SVG units). x: 0–100 field units → 0–1000. y: yards from the line.
export const W = 1000;
export const FIELD_H = 650;
const CAP_COLS = 3;
const CAP_ROW = 28;
/** Total chart height: the field plus a caption listing the macro's team settings. */
export function chartHeight(lines: number) {
  return lines ? FIELD_H + 46 + Math.ceil(lines / CAP_COLS) * CAP_ROW + 14 : FIELD_H;
}
const BAND = 74; // title band at the top
const YS = 14; // px per yard
const LOS = BAND + 27 * YS; // line of scrimmage
const px = (x: number) => x * 10;
const py = (y: number) => LOS - y * YS;

export const COLORS: Record<Group, { fill: string; ink: string }> = {
  OL: { fill: "#5b6875", ink: "#eef2f6" },
  QB: { fill: "#f0457f", ink: "#ffffff" },
  RB: { fill: "#14c8b0", ink: "#06231e" },
  WR: { fill: "#5aa9ff", ink: "#071a33" },
  TE: { fill: "#f7b32b", ink: "#2a1a00" },
  DL: { fill: "#f6735f", ink: "#2b0904" },
  LB: { fill: "#a78bfa", ink: "#1a0b3d" },
  CB: { fill: "#5aa9ff", ink: "#071a33" },
  S: { fill: "#14c8b0", ink: "#06231e" },
};

export type ChartProps = {
  side: "O" | "D";
  players: Player[];
  ghosts: Player[];
  steps: Map<string, Step>; // effective step per player
  adj: Record<string, string>; // team settings
  ctx: DefCtx;
  caption: { label: string; value: string }[];
  selected: string | null;
  title: string;
  subtitle: string;
  personnel: string;
  onSelect: (id: string | null) => void;
  onMove: (id: string, x: number, y: number) => void;
  /** Bigger players for small screens. */
  big?: boolean;
};

export const FieldChart = forwardRef<SVGSVGElement, ChartProps>(function FieldChart(props, ref) {
  const { side, players, ghosts, steps, adj, ctx, caption, selected, title, subtitle, personnel, onSelect, onMove, big } = props;
  const H = chartHeight(caption.length);
  const R = big ? 29 : 22;
  const k = big ? 1.3 : 1;
  const drag = useRef<{ id: string; sx: number; sy: number; moved: boolean } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const toField = (e: React.PointerEvent) => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    return { x: p.x / 10, y: (LOS - p.y) / YS, sx: p.x, sy: p.y };
  };

  const byId = new Map(players.map((p) => [p.id, p]));
  const qbSpot = (side === "D" ? ghosts : players).find((p) => p.label === "QB") ?? { x: 50, y: -5 };

  const yardLines = [-10, -5, 5, 10, 15, 20, 25];

  return (
    <svg
      ref={(el) => {
        svgRef.current = el;
        if (typeof ref === "function") ref(el);
        else if (ref) ref.current = el;
      }}
      viewBox={`0 0 ${W} ${H}`}
      className="mb-chart"
      role="img"
      aria-label={`${title} chart`}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget || (e.target as Element).getAttribute("data-bg")) onSelect(null);
      }}
    >
      <defs>
        <linearGradient id="mb-turf" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0d3527" />
          <stop offset="1" stopColor="#082219" />
        </linearGradient>
        <filter id="mb-glow" x="-10%" y="-200%" width="120%" height="500%">
          <feGaussianBlur stdDeviation="5" />
        </filter>
        {["#ffffff", "#ef4444", "#f97316", "#cbd5e1"].map((c) => (
          <marker key={c} id={`mb-arrow-${c.slice(1)}`} viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill={c} />
          </marker>
        ))}
      </defs>

      {/* field */}
      <rect data-bg="1" x="0" y="0" width={W} height={FIELD_H} fill="url(#mb-turf)" />
      <rect data-bg="1" x="0" y="0" width={W} height={BAND} fill="#06180f" opacity="0.85" />
      {yardLines.map((y) => (
        <line key={y} x1="20" x2={W - 20} y1={py(y)} y2={py(y)} stroke="#ffffff" strokeOpacity={y % 10 === 0 ? 0.16 : 0.08} strokeWidth="2" pointerEvents="none" />
      ))}
      {Array.from({ length: 42 }, (_, i) => -13 + i).map((y) => (
        <g key={y} stroke="#ffffff" strokeOpacity="0.18" strokeWidth="2" pointerEvents="none">
          <line x1="10" x2="26" y1={py(y)} y2={py(y)} />
          <line x1={W - 26} x2={W - 10} y1={py(y)} y2={py(y)} />
          <line x1="357" x2="371" y1={py(y)} y2={py(y)} />
          <line x1="629" x2="643" y1={py(y)} y2={py(y)} />
        </g>
      ))}
      <line x1="30" x2={W - 30} y1={LOS} y2={LOS} stroke="#f2c200" strokeWidth="10" opacity="0.35" filter="url(#mb-glow)" pointerEvents="none" />
      <line x1="30" x2={W - 30} y1={LOS} y2={LOS} stroke="#f2c200" strokeWidth="3" pointerEvents="none" />

      {/* title */}
      <text x={W / 2} y={subtitle ? 36 : 46} textAnchor="middle" className="mb-title">{title.toUpperCase()}</text>
      {subtitle && <text x={W / 2} y={60} textAnchor="middle" className="mb-subtitle">{subtitle}</text>}

      {/* zones first, so lines and players sit on top */}
      {side === "D" && [...steps.values()].map((st) => {
        const p = byId.get(st.p);
        const o = findDefOption(st.k);
        if (!p || !o || o.kind !== "zone") return null;
        const z = zoneFor(o, p, ctx);
        if (!z) return null;
        return (
          <g key={`z-${st.p}`} pointerEvents="none">
            <ellipse cx={px(z.x)} cy={py(z.y)} rx={z.rx * 10} ry={z.ry * YS} fill={o.color} fillOpacity="0.32" stroke={o.color} strokeWidth="2.5" />
          </g>
        );
      })}

      {/* slide protection */}
      {side === "O" && adj.slide && (
        <g pointerEvents="none">
          <path
            d={adj.slide === "slide-left" ? `M ${px(63)} ${py(0.75)} L ${px(36)} ${py(0.75)}` : `M ${px(37)} ${py(0.75)} L ${px(64)} ${py(0.75)}`}
            stroke="#cbd5e1" strokeWidth="4" fill="none" markerEnd="url(#mb-arrow-cbd5e1)"
          />
        </g>
      )}

      {/* team-wide pressure: stunts, QB contain, LB blitzes */}
      {side === "D" && <g pointerEvents="none">{drawTeam(players, steps, adj)}</g>}

      {/* individual assignment lines */}
      {[...steps.values()].map((st) => {
        const p = byId.get(st.p);
        if (!p) return null;
        if (side === "D") {
          const o = findDefOption(st.k);
          return o ? <g key={`a-${st.p}`} pointerEvents="none">{drawDef(o, p, ctx, qbSpot)}</g> : null;
        }
        const o = findOffOption(st.k);
        return o ? <g key={`a-${st.p}`} pointerEvents="none">{drawOff(o, p, R)}</g> : null;
      })}

      {/* opponent, faded */}
      {ghosts.map((p) => (
        <g key={`g-${p.id}`} pointerEvents="none" opacity="0.5">
          <circle cx={px(p.x)} cy={py(p.y)} r={R - 4} fill="none" stroke={COLORS[p.group].fill} strokeWidth="2.5" strokeDasharray="5 4" />
          <text x={px(p.x)} y={py(p.y)} dy="0.35em" textAnchor="middle" className="mb-ghost-label" style={{ fontSize: (fontFor(p.label) - 3) * k }}>
            {p.label}
          </text>
        </g>
      ))}

      {/* players */}
      {players.map((p) => {
        const c = COLORS[p.group];
        const isSel = p.id === selected;
        return (
          <g
            key={p.id}
            className="mb-player"
            transform={`translate(${px(p.x)} ${py(p.y)})`}
            onPointerDown={(e) => {
              e.stopPropagation();
              (e.currentTarget as Element).setPointerCapture(e.pointerId);
              const f = toField(e);
              drag.current = { id: p.id, sx: f.sx, sy: f.sy, moved: false };
            }}
            onPointerMove={(e) => {
              const d = drag.current;
              if (!d || d.id !== p.id) return;
              const f = toField(e);
              if (!d.moved && Math.hypot(f.sx - d.sx, f.sy - d.sy) < 6) return;
              d.moved = true;
              const minY = side === "D" ? 0.8 : -14;
              const maxY = side === "D" ? 26 : -0.6;
              onMove(p.id, Math.min(98, Math.max(2, f.x)), Math.min(maxY, Math.max(minY, f.y)));
            }}
            onPointerUp={() => {
              const d = drag.current;
              drag.current = null;
              if (d && !d.moved) onSelect(p.id === selected ? null : p.id);
            }}
            onPointerCancel={() => (drag.current = null)}
            role="button"
            tabIndex={0}
            aria-label={`${p.label}${isSel ? ", selected" : ""}`}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(p.id === selected ? null : p.id);
              }
            }}
          >
            <circle r={R + 12} fill="transparent" />
            {isSel && <circle r={R + 7} fill="none" stroke="#f2c200" strokeWidth="4" />}
            <circle r={R} fill={c.fill} stroke="rgba(0,0,0,0.35)" strokeWidth="2" />
            <text dy="0.35em" textAnchor="middle" fill={c.ink} className="mb-label" style={{ fontSize: fontFor(p.label) * k }}>
              {p.label}
            </text>
          </g>
        );
      })}

      {/* personnel chip + credit */}
      <g pointerEvents="none">
        <rect x="22" y={FIELD_H - 50} width={personnel.length * 10.5 + 32} height="34" rx="8" fill="#06180f" opacity="0.85" stroke="#ffffff" strokeOpacity="0.15" />
        <text x="38" y={FIELD_H - 27} className="mb-chip">{personnel}</text>
        <text x={W - 24} y={FIELD_H - 27} textAnchor="end" className="mb-credit">CFM Manager · Macro Builder</text>
      </g>

      {/* team settings caption */}
      {caption.length > 0 && (
        <g pointerEvents="none">
          <rect data-bg="1" x="0" y={FIELD_H} width={W} height={H - FIELD_H} fill="#06180f" />
          <line x1="0" x2={W} y1={FIELD_H} y2={FIELD_H} stroke="#f2c200" strokeWidth="3" />
          <text x="30" y={FIELD_H + 32} className="mb-cap-h">MACRO SETTINGS</text>
          {caption.map((c, i) => {
            const rows = Math.ceil(caption.length / CAP_COLS);
            const col = Math.floor(i / rows);
            const row = i % rows;
            return (
              <text key={c.label} x={30 + col * 323} y={FIELD_H + 66 + row * CAP_ROW} className="mb-cap">
                <tspan className="mb-cap-k">{c.label}: </tspan>
                <tspan className="mb-cap-v">{c.value}</tspan>
              </text>
            );
          })}
        </g>
      )}
    </svg>
  );
});

function fontFor(label: string) {
  return label.length <= 2 ? 18 : label.length === 3 ? 15.5 : 12.5;
}

function arrowId(color: string) {
  const c = color.toLowerCase();
  return ["#ffffff", "#ef4444", "#f97316", "#cbd5e1"].includes(c) ? `url(#mb-arrow-${c.slice(1)})` : "url(#mb-arrow-ffffff)";
}

const GAPS = [30, 35, 41, 47, 53, 59, 65, 70];
const rushTarget = (x: number) => GAPS.reduce((b, g) => (Math.abs(g - x) < Math.abs(b - x) ? g : b), GAPS[0]);

function rushPath(p: Player) {
  const x0 = px(p.x);
  const y0 = py(p.y);
  const gx = px(rushTarget(p.x));
  return `M ${x0} ${y0} Q ${gx} ${py(Math.min(p.y, 1.5))} ${gx} ${py(-4.5)}`;
}

function drawDef(o: DefOption, p: Player, ctx: DefCtx, qb: { x: number; y: number }) {
  const x0 = px(p.x);
  const y0 = py(p.y);
  switch (o.kind) {
    case "zone": {
      const z = zoneFor(o, p, ctx);
      if (!z) return null;
      return <line x1={x0} y1={y0} x2={px(z.x)} y2={py(z.y)} stroke={o.color} strokeWidth="4" strokeLinecap="round" />;
    }
    case "blitz":
      return <path d={rushPath(p)} stroke={o.color} strokeWidth="4.5" fill="none" markerEnd={arrowId(o.color)} />;
    case "bluff": {
      // Shows pressure, then drops: a short dashed step forward and back.
      const fx = px(p.x + (p.x < 50 ? 2 : -2));
      return (
        <g>
          <path d={`M ${x0} ${y0} L ${fx} ${py(Math.max(0.3, p.y - 1.4))}`} stroke={o.color} strokeWidth="4" strokeDasharray="6 6" fill="none" />
          <path d={`M ${fx} ${py(Math.max(0.3, p.y - 1.4))} Q ${fx} ${py(p.y + 2.5)} ${x0} ${py(p.y + 4)}`} stroke={o.color} strokeWidth="3.5" fill="none" markerEnd={arrowId(o.color)} />
        </g>
      );
    }
    case "spy": {
      const ty = 2.5;
      return (
        <g>
          <line x1={x0} y1={y0} x2={px(qb.x)} y2={py(ty)} stroke={o.color} strokeWidth="4" strokeDasharray="8 7" />
          <circle cx={px(qb.x)} cy={py(ty)} r="9" fill={o.color} />
        </g>
      );
    }
  }
  return null;
}

function drawTeam(players: Player[], steps: Map<string, Step>, adj: Record<string, string>) {
  const free = (p: Player) => !steps.has(p.id);
  const out: React.ReactNode[] = [];
  const line = [...players.filter((p) => p.group === "DL")].sort((a, b) => a.x - b.x);

  // QB contain: the edge on that side rushes outside-in. The defense's left is the right of the chart.
  const contain: Player[] = [];
  if (adj.qc && line.length) {
    if (adj.qc === "left" || adj.qc === "both") contain.push(line[line.length - 1]);
    if ((adj.qc === "right" || adj.qc === "both") && line.length > 1) contain.push(line[0]);
  }

  // Stunts: worked out from the whole line, then drawn for the men who aren't doing something else.
  if (adj.stu) {
    for (const m of stuntMoves(adj.stu, line)) {
      const p = players.find((q) => q.id === m.id);
      if (!p || !free(p) || contain.includes(p)) continue;
      const x0 = px(p.x);
      const y0 = py(p.y);
      const tx = px(p.x + m.dx);
      const d = m.kind === "crash"
        ? `M ${x0} ${y0} Q ${tx} ${py(0.4)} ${tx} ${py(-3.8)}`
        : `M ${x0} ${y0} C ${x0} ${py(p.y + 2.6)} ${tx} ${py(p.y + 2.6)} ${tx} ${py(-3.8)}`;
      out.push(
        <path key={`st-${p.id}`} d={d} stroke={ZC.rush} strokeWidth={m.kind === "crash" ? 4.5 : 4} strokeDasharray={m.kind === "loop" ? "9 6" : undefined} fill="none" markerEnd={arrowId(ZC.rush)} />,
      );
    }
  }

  for (const p of contain) {
    if (!free(p)) continue;
    const o = p.x < 50 ? -1 : 1;
    const x0 = px(p.x);
    const y0 = py(p.y);
    out.push(
      <path key={`qc-${p.id}`} d={`M ${x0} ${y0} L ${px(p.x + o * 3)} ${py(-0.5)} Q ${px(p.x + o * 3)} ${py(-4.6)} ${px(p.x - o * 3)} ${py(-5.6)}`}
        stroke={ZC.rush} strokeWidth="4.5" fill="none" markerEnd={arrowId(ZC.rush)} />,
    );
  }

  // LB Assignments
  if (adj.lba && adj.lba !== "zone-all") {
    const lbs = players.filter((p) => p.group === "LB" && free(p) && roleOf(p));
    const who = adj.lba === "blitz-all" ? lbs : lbs.filter((p) => p.label === (adj.lba === "sam-blitz" ? "SAM" : "WILL"));
    for (const p of who) out.push(<path key={`lb-${p.id}`} d={rushPath(p)} stroke={ZC.rush} strokeWidth="4.5" fill="none" markerEnd={arrowId(ZC.rush)} />);
  }
  return out;
}

function drawOff(a: OffOption, p: Player, R: number) {
  const x0 = px(p.x);
  const y0 = py(p.y);
  switch (a.kind) {
    case "route": {
      const r = a.path;
      if (!r) return null;
      const dir = p.x < 50 ? -1 : 1;
      const pts = r.pts.map(([dx, dy]) => [px(p.x + dx * dir), py(p.y + dy)] as const);
      let d = `M ${x0} ${y0 - (p.y > -1.5 ? R : 0)}`;
      if (r.curve && pts.length >= 2) {
        d += ` Q ${pts[0][0]} ${pts[0][1]} ${pts[1][0]} ${pts[1][1]}`;
        for (let i = 2; i < pts.length; i++) d += ` L ${pts[i][0]} ${pts[i][1]}`;
      } else {
        for (const [x, y] of pts) d += ` L ${x} ${y}`;
      }
      return <path d={d} stroke="#ffffff" strokeWidth="4" fill="none" strokeLinejoin="round" markerEnd={arrowId("#ffffff")} />;
    }
    case "block":
      return (
        <g stroke={a.color} strokeWidth="5" strokeLinecap="round">
          <line x1={x0} y1={y0 - R} x2={x0} y2={y0 - R - 16} />
          <line x1={x0 - 14} y1={y0 - R - 16} x2={x0 + 14} y2={y0 - R - 16} />
        </g>
      );
    case "motion": {
      const tx = px(100 - p.x > 50 ? Math.min(100 - p.x, 80) : Math.max(100 - p.x, 20));
      return <path d={`M ${x0} ${y0 + R} Q ${(x0 + tx) / 2} ${y0 + 70} ${tx} ${y0 + R}`} stroke={a.color} strokeWidth="3.5" fill="none" strokeDasharray="9 7" markerEnd={arrowId(a.color)} />;
    }
  }
  return null;
}
