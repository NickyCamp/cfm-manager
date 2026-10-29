"use client";
import { forwardRef, useRef } from "react";
import type { Group, Player } from "@/lib/macro/layout";
import { findAssignment, OFFENSE_ASSIGNMENTS, type Assignment } from "@/lib/macro/macros";
import type { Step } from "@/lib/macro/share";

// Chart geometry (SVG units). x: 0–100 field units → 0–1000. y: yards from the line.
export const W = 1000;
export const H = 650;
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
  slide?: string;
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
  const { side, players, ghosts, steps, slide, selected, title, subtitle, personnel, onSelect, onMove, big } = props;
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
  const ghostById = new Map(ghosts.map((p) => [p.id, p]));
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
      <rect data-bg="1" x="0" y="0" width={W} height={H} fill="url(#mb-turf)" />
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
        const a = findAssignment("D", st.k);
        if (!p || !a || a.kind !== "zone") return null;
        const spot = a.spots?.find((s) => s.id === st.s) ?? a.spots?.[0];
        if (!spot) return null;
        return (
          <g key={`z-${st.p}`} pointerEvents="none">
            <ellipse cx={px(spot.x)} cy={py(spot.y)} rx={spot.rx * 10} ry={spot.ry * YS} fill={a.color} fillOpacity="0.32" stroke={a.color} strokeWidth="2.5" />
          </g>
        );
      })}

      {/* slide protection */}
      {side === "O" && slide && (
        <g pointerEvents="none">
          <path
            d={slide === "left" ? `M ${px(63)} ${py(0.75)} L ${px(36)} ${py(0.75)}` : `M ${px(37)} ${py(0.75)} L ${px(64)} ${py(0.75)}`}
            stroke="#cbd5e1" strokeWidth="4" fill="none" markerEnd="url(#mb-arrow-cbd5e1)"
          />
        </g>
      )}

      {/* assignment lines */}
      {[...steps.values()].map((st) => {
        const p = byId.get(st.p);
        const a = findAssignment(side, st.k);
        if (!p || !a) return null;
        return <g key={`a-${st.p}`} pointerEvents="none">{drawAssignment(a, st, p, ghostById, qbSpot, R)}</g>;
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
        <rect x="22" y={H - 50} width={personnel.length * 10.5 + 32} height="34" rx="8" fill="#06180f" opacity="0.85" stroke="#ffffff" strokeOpacity="0.15" />
        <text x="38" y={H - 27} className="mb-chip">{personnel}</text>
        <text x={W - 24} y={H - 27} textAnchor="end" className="mb-credit">CFM Manager · Macro Builder</text>
      </g>
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

function drawAssignment(a: Assignment, st: Step, p: Player, ghosts: Map<string, Player>, qb: { x: number; y: number }, R: number) {
  const x0 = px(p.x);
  const y0 = py(p.y);
  switch (a.kind) {
    case "zone": {
      const spot = a.spots?.find((s) => s.id === st.s) ?? a.spots?.[0];
      if (!spot) return null;
      return <line x1={x0} y1={y0} x2={px(spot.x)} y2={py(spot.y)} stroke={a.color} strokeWidth="4" strokeLinecap="round" />;
    }
    case "blitz": {
      const spot = a.spots?.find((s) => s.id === st.s) ?? a.spots?.[0];
      if (!spot) return null;
      const gx = px(spot.x);
      return <path d={`M ${x0} ${y0} Q ${gx} ${py(1.5)} ${gx} ${py(-4.5)}`} stroke={a.color} strokeWidth="4.5" fill="none" markerEnd={arrowId(a.color)} />;
    }
    case "contain": {
      const spot = a.spots?.find((s) => s.id === st.s) ?? a.spots?.[0];
      if (!spot) return null;
      const out = spot.x < 50 ? -1 : 1;
      return (
        <path
          d={`M ${x0} ${y0} L ${px(spot.x + out * 2)} ${py(0)} Q ${px(spot.x + out * 2)} ${py(-4)} ${px(spot.x - out * 4)} ${py(-5)}`}
          stroke={a.color} strokeWidth="4.5" fill="none" markerEnd={arrowId(a.color)}
        />
      );
    }
    case "spy": {
      const ty = 2.5;
      return (
        <g>
          <line x1={x0} y1={y0} x2={px(qb.x)} y2={py(ty)} stroke={a.color} strokeWidth="4" strokeDasharray="8 7" />
          <circle cx={px(qb.x)} cy={py(ty)} r="9" fill={a.color} />
        </g>
      );
    }
    case "man": {
      const tgt = st.t ? ghosts.get(st.t) : undefined;
      if (tgt) {
        return <line x1={x0} y1={y0} x2={px(tgt.x)} y2={py(tgt.y) - (R - 4)} stroke={a.color} strokeWidth="4" strokeDasharray="10 7" />;
      }
      return (
        <g>
          <line x1={x0} y1={y0 + R} x2={x0} y2={y0 + 52} stroke={a.color} strokeWidth="4" strokeDasharray="8 6" />
          <text x={x0} y={y0 + 72} textAnchor="middle" className="mb-tag" fill={a.color}>MAN</text>
        </g>
      );
    }
    case "route": {
      const r = OFFENSE_ASSIGNMENTS.find((o) => o.key === a.key)?.path;
      if (!r) return null;
      const dir = p.x < 50 ? -1 : 1;
      const pts = r.pts.map(([dx, dy]) => [px(p.x + dx * dir * 1.0), py(p.y + dy)] as const);
      let d = `M ${x0} ${y0 - (p.y > -1.5 ? R : 0)}`;
      if (r.curve && pts.length >= 2) {
        d += ` Q ${pts[0][0]} ${pts[0][1]} ${pts[1][0]} ${pts[1][1]}`;
        for (let i = 2; i < pts.length; i++) d += ` L ${pts[i][0]} ${pts[i][1]}`;
      } else {
        for (const [x, y] of pts) d += ` L ${x} ${y}`;
      }
      return <path d={d} stroke="#ffffff" strokeWidth="4" fill="none" strokeLinejoin="round" markerEnd={arrowId("#ffffff")} />;
    }
    case "block": {
      return (
        <g stroke={a.color} strokeWidth="5" strokeLinecap="round">
          <line x1={x0} y1={y0 - R} x2={x0} y2={y0 - R - 16} />
          <line x1={x0 - 14} y1={y0 - R - 16} x2={x0 + 14} y2={y0 - R - 16} />
        </g>
      );
    }
    case "motion": {
      const tx = px(100 - p.x > 50 ? Math.min(100 - p.x, 80) : Math.max(100 - p.x, 20));
      return (
        <g>
          <path d={`M ${x0} ${y0 + R} Q ${(x0 + tx) / 2} ${y0 + 70} ${tx} ${y0 + R}`} stroke={a.color} strokeWidth="3.5" fill="none" strokeDasharray="9 7" markerEnd={arrowId(a.color)} />
        </g>
      );
    }
  }
  return null;
}
