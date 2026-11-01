"use client";

import { useRef, useState } from "react";
import type { CardStat } from "@/lib/league/cardStats";

export type PlayerCardProps = {
  first: string;
  last: string;
  pos: string;
  jersey: number;
  ovr: number;
  dev: 0 | 1 | 2 | 3;
  rookie: boolean;
  teamAbbr: string;
  primary: string;
  secondary: string;
  setLabel: string;      // e.g. "2027 NCL"
  exp: string;           // "Rookie", "4th yr"
  age: number;
  height: string;        // 6'2"
  weight: number;
  college: string;
  draft: string;         // "R1 #12, 2024" or "Undrafted"
  art?: string;
  stats: CardStat[];
};

const TIER = ["normal", "star", "super", "xf"] as const;
const CHIP = ["", "Star", "Superstar", "X-Factor"];

/** Football-card style player card: foil by dev trait, tilts with the pointer, tap to flip. */
export function PlayerCard(p: PlayerCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [flipped, setFlipped] = useState(false);
  const down = useRef<{ x: number; y: number } | null>(null);

  const set = (k: string, v: string) => ref.current?.style.setProperty(k, v);
  const move = (e: React.PointerEvent) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return;
    el.classList.add("live");
    set("--ry", `${((x - 0.5) * 22).toFixed(1)}deg`);
    set("--rx", `${((0.5 - y) * 22).toFixed(1)}deg`);
    set("--mx", `${Math.round(x * 100)}%`);
    set("--my", `${Math.round(y * 100)}%`);
    set("--glare", "1");
  };
  const reset = () => {
    ref.current?.classList.remove("live");
    set("--rx", "0deg"); set("--ry", "0deg"); set("--glare", "0");
  };
  const tier = TIER[p.dev] ?? "normal";
  const style = { "--tc1": p.primary, "--tc2": p.secondary } as React.CSSProperties;

  return (
    <div className="pcard-wrap">
      <div
        className="pcard-stage"
        onPointerMove={move}
        onPointerLeave={reset}
        onPointerCancel={reset}
        onPointerDown={(e) => { down.current = { x: e.clientX, y: e.clientY }; }}
        onPointerUp={(e) => {
          const d = down.current;
          if (d && Math.abs(e.clientX - d.x) < 8 && Math.abs(e.clientY - d.y) < 8) setFlipped((f) => !f);
          down.current = null;
          if (e.pointerType !== "mouse") setTimeout(reset, 500);
        }}
      >
        <div ref={ref} className={`pcard t-${tier} ${flipped ? "flipped" : ""}`} style={style} role="button" tabIndex={0}
          aria-label={`${p.first} ${p.last} card, ${flipped ? "back" : "front"}. Activate to flip.`}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setFlipped((f) => !f); } }}>
          <div className="pcard-face pcard-front">
            <div className="pcard-inner">
              <div className={`pcard-art ${p.art ? "has-img" : ""}`}>
                {p.art
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={p.art} alt="" />
                  : <div className="pcard-ph"><div className="num">{p.jersey}</div><div className="pos">{p.pos}</div></div>}
              </div>
              <div className="pcard-band" />
              <div className="pcard-setno">{p.setLabel}</div>
              <div className="pcard-plate">
                <div className="name">{p.first} {p.last}</div>
                <div className="meta"><span>{p.teamAbbr} · {p.pos} · #{p.jersey}</span><span>{p.exp}</span></div>
              </div>
              <div className="pcard-ovr"><b>{p.ovr}</b><span>OVR</span></div>
              {CHIP[p.dev] && <div className="pcard-chip">{CHIP[p.dev]}</div>}
              {p.rookie && <div className="pcard-rc">RC</div>}
              <div className="pcard-foil" /><div className="pcard-glare" />
            </div>
          </div>
          <div className="pcard-face pcard-back">
            <div className="pcard-inner pcard-inner-back">
              <div className="pcard-bhead">
                <span className="bnum">{p.jersey}</span>
                <span className="bname">{p.first} {p.last}</span>
                <span className="bpos">{p.pos}</span>
              </div>
              <div className="pcard-bio">
                <div><span>Age</span><b>{p.age}</b></div>
                <div><span>Height</span><b>{p.height || "—"}</b></div>
                <div><span>Weight</span><b>{p.weight ? `${p.weight} lb` : "—"}</b></div>
                <div><span>Exp</span><b>{p.exp}</b></div>
                <div className="wide"><span>College</span><b>{p.college || "—"}</b></div>
                <div className="wide"><span>Draft</span><b>{p.draft}</b></div>
              </div>
              <div className="pcard-attrs">
                {p.stats.length === 0 && <p className="pcard-none">Ratings arrive with the next sync.</p>}
                {p.stats.map((s, i) => (
                  <div key={s.label} className={`attr ${!s.core && i > 0 && p.stats[i - 1].core ? "first-pos" : ""}`}>
                    <span className="lbl">{s.label}</span>
                    <span className="bar"><i style={{ width: `${Math.max(0, Math.min(99, s.value))}%` }} className={s.value >= 90 ? "hi" : s.value >= 80 ? "good" : ""} /></span>
                    <b>{s.value}</b>
                  </div>
                ))}
              </div>
              <div className="pcard-bfoot">{p.setLabel} · {p.teamAbbr}</div>
            </div>
          </div>
        </div>
      </div>
      <button type="button" className="pcard-flip" onClick={() => setFlipped((f) => !f)}>
        {flipped ? "Show front" : "Flip card"}
      </button>
    </div>
  );
}
