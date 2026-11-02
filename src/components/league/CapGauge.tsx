"use client";

import { useEffect, useRef, useState } from "react";

/** Cap used, as a tank of liquid that fills on view and sloshes. Team color while
 *  there's room, amber at 95%+, red when over the cap. */
export function CapGauge({ used, color }: { used: number; color: string }) {
  const pct = Math.max(0, used);
  const [fill, setFill] = useState(pct);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setFill(0);
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); requestAnimationFrame(() => setFill(pct)); } }, { threshold: 0.4 });
    io.observe(el);
    return () => io.disconnect();
  }, [pct]);
  const tone = pct > 100 ? "#c8102e" : pct >= 95 ? "#d98a00" : color;
  return (
    <div ref={ref} className="cap-gauge" role="img" aria-label={`${pct.toFixed(0)}% of the cap used`}>
      <div className="cap-gauge-liquid" style={{ width: `${Math.min(100, fill)}%`, background: tone }}>
      </div>
      <span className="cap-gauge-label">{pct.toFixed(0)}% of cap used{pct > 100 ? " · over the cap" : ""}</span>
    </div>
  );
}
