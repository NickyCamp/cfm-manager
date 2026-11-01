"use client";

import { useEffect, useRef, useState } from "react";
import { money } from "@/lib/league/format";

/** A money figure that counts up from zero the first time it scrolls into view.
 *  Server-rendered with the final value, so it reads correctly without JS. */
export function CountUp({ value, ms = 900 }: { value: number; ms?: number }) {
  const [shown, setShown] = useState(value);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setShown(value); return; }
    let raf = 0;
    const run = () => {
      const t0 = performance.now();
      const step = (t: number) => {
        const k = Math.min(1, (t - t0) / ms);
        const eased = 1 - Math.pow(1 - k, 3);
        setShown(k >= 1 ? value : value * eased);
        if (k < 1) raf = requestAnimationFrame(step);
      };
      setShown(0);
      raf = requestAnimationFrame(step);
    };
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { io.disconnect(); run(); }
    }, { threshold: 0.3 });
    io.observe(el);
    return () => { io.disconnect(); cancelAnimationFrame(raf); };
  }, [value, ms]);

  // Round to the shown precision so the text doesn't jitter between digits.
  const display = shown === value ? money(value) : money(Math.round(shown / 1e4) * 1e4);
  return <span ref={ref} className="countup">{display}</span>;
}
