"use client";

import { useEffect, useRef, useState } from "react";

/** Stadium-board style number: each digit sits on a split-flap tile and riffles
 *  through numbers before landing, the first time it scrolls into view. */
export function FlapNumber({ value, className = "" }: { value: number; className?: string }) {
  const final = String(value);
  const [digits, setDigits] = useState(final);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let timer = 0;
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      let tick = 0;
      const ticks = 9;
      timer = window.setInterval(() => {
        tick++;
        // Digits land left to right, like a board settling.
        setDigits(final.split("").map((d, i) => (tick >= ticks - (final.length - 1 - i) * 2 ? d : String(Math.floor(Math.random() * 10)))).join(""));
        if (tick >= ticks) { clearInterval(timer); setDigits(final); }
      }, 55);
    }, { threshold: 0.5 });
    io.observe(el);
    return () => { io.disconnect(); clearInterval(timer); };
  }, [final]);

  return (
    <span ref={ref} className={`flap ${className}`} aria-label={final}>
      {digits.split("").map((d, i) => <span key={i} className="flap-tile" aria-hidden>{d}</span>)}
    </span>
  );
}
