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
  abilities: { title: string; tier: string }[];
  stats: CardStat[];
};

const TIER = ["normal", "star", "super", "xf"] as const;
const TIER_RANK: Record<string, number> = { single: 0, gold: 1, silver: 2, bronze: 3 };
const tierClass = (t: string) => (t.toLowerCase() in TIER_RANK ? t.toLowerCase() : "bronze");
const sortAbilities = (a: { title: string; tier: string }[]) =>
  [...a].sort((x, y) => (TIER_RANK[tierClass(x.tier)] ?? 9) - (TIER_RANK[tierClass(y.tier)] ?? 9));
const initials = (t: string) => t.replace(/[^A-Za-z0-9 ]/g, " ").split(/\s+/).filter(Boolean).map((w) => w[0]).join("").slice(0, 3).toUpperCase();

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
                  : <div className="pcard-ph" aria-hidden><span>{p.jersey}</span></div>}
              </div>
              <div className="pcard-shade" />
              <div className="pcard-jersey">#{p.jersey}</div>
              <div className="pcard-side">
                <b className="ovr">{p.ovr}</b>
                <span className="pos">{p.pos}</span>
                <span className="team">{p.teamAbbr}</span>
                {p.rookie && <span className="rc">RC</span>}
                {sortAbilities(p.abilities).slice(0, 5).map((a) => (
                  <span key={a.title} className={`abil ab-${tierClass(a.tier)}`} title={`${a.title} (${a.tier === "Single" ? "X-Factor" : a.tier})`}>{initials(a.title)}</span>
                ))}
              </div>
              <Nameplate first={p.first} last={p.last} />
              <div className="pcard-foil" /><div className="pcard-glare" />
            </div>
          </div>
          <div className="pcard-face pcard-back">
            <div className="pcard-inner pcard-inner-back">
              <div className="pcard-art faded" aria-hidden>
                {p.art
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={p.art} alt="" />
                  : <div className="pcard-ph"><span>{p.jersey}</span></div>}
              </div>
              <div className="pcard-keys">
                <div className="khead">
                  <span>Key attributes</span>
                  <span className="kmeta"><b>{p.ovr}</b> OVR · #{p.jersey}</span>
                </div>
                <div className="kteam"><span className="team">{p.teamAbbr}</span><span>{p.pos}</span><span className="muted">{p.exp}</span></div>
                <div className="kgrid">
                  <div><span>HT</span><b>{p.height || "—"}</b></div>
                  <div><span>WT</span><b>{p.weight || "—"}</b></div>
                  <div><span>AGE</span><b>{p.age}</b></div>
                  {p.stats.map((s) => (
                    <div key={s.abbr + s.label} title={s.label} className={s.value >= 90 ? "hi" : ""}><span>{s.abbr}</span><b>{s.value}</b></div>
                  ))}
                </div>
                {p.stats.length === 0 && <p className="pcard-none">Ratings arrive with the next sync.</p>}
                {p.abilities.length > 0 && (
                  <div className="kabil">{sortAbilities(p.abilities).map((a) => (
                    <span key={a.title} className={`ab-${tierClass(a.tier)}`}>{a.title}</span>
                  ))}</div>
                )}
                <div className="kbio">{p.college || "No college"} · {p.draft}</div>
              </div>
              <Nameplate first={p.first} last={p.last} small />
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

function Nameplate({ first, last, small = false }: { first: string; last: string; small?: boolean }) {
  return (
    <div className={`pcard-name ${small ? "small" : ""}`}>
      <span className="first">{first}</span>
      <span className="last">{last}</span>
    </div>
  );
}
