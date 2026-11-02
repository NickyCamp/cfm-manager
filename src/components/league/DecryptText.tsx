"use client";

import { useEffect, useRef, useState } from "react";

const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#$%&";

/** Text that scrambles and then resolves left to right when it scrolls into view ("the pick is in"). */
export function DecryptText({ text, delay = 0 }: { text: string; delay?: number }) {
  const [shown, setShown] = useState(text);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let iv = 0, to = 0;
    const scramble = (upto: number) => text.split("").map((c, i) => (i < upto || c === " " ? c : GLYPHS[Math.floor(Math.random() * GLYPHS.length)])).join("");
    const io = new IntersectionObserver((es) => {
      if (!es.some((e) => e.isIntersecting)) return;
      io.disconnect();
      setShown(scramble(0));
      to = window.setTimeout(() => {
        let n = 0;
        iv = window.setInterval(() => {
          n += Math.max(1, Math.ceil(text.length / 14));
          setShown(n >= text.length ? text : scramble(n));
          if (n >= text.length) clearInterval(iv);
        }, 45);
      }, delay);
    }, { threshold: 0.6 });
    io.observe(el);
    return () => { io.disconnect(); clearInterval(iv); clearTimeout(to); };
  }, [text, delay]);
  return <span ref={ref} aria-label={text}><span aria-hidden>{shown}</span></span>;
}
