"use client";
import { useEffect } from "react";

// Scrolls a horizontally scrolling strip so the selected item is visible
// (the week chips open on the week being shown, not week 1).
export function ScrollCurrentIntoView({ selector }: { selector: string }) {
  useEffect(() => {
    const el = document.querySelector<HTMLElement>(selector);
    const strip = el?.parentElement;
    if (el && strip) strip.scrollLeft = el.offsetLeft - strip.offsetLeft - strip.clientWidth / 2 + el.clientWidth / 2;
  }, [selector]);
  return null;
}
