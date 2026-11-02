"use client";

import { useRef, useState } from "react";

/** Press and hold to confirm, for things that can't be undone. Enter/Space also hold. */
export function HoldButton({ children, onConfirm, ms = 1000, disabled }: { children: React.ReactNode; onConfirm: () => void; ms?: number; disabled?: boolean }) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<number | null>(null);
  const start = () => {
    if (disabled || timer.current) return;
    setHolding(true);
    timer.current = window.setTimeout(() => { timer.current = null; setHolding(false); onConfirm(); }, ms);
  };
  const stop = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } setHolding(false); };
  return (
    <button type="button" className={`hold-btn ${holding ? "holding" : ""}`} disabled={disabled} style={{ "--hold-ms": `${ms}ms` } as React.CSSProperties}
      onPointerDown={start} onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop}
      onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && !e.repeat) { e.preventDefault(); start(); } }}
      onKeyUp={(e) => { if (e.key === "Enter" || e.key === " ") stop(); }}
      onContextMenu={(e) => e.preventDefault()}>
      <span className="hold-fill" aria-hidden />
      <span className="hold-label">{children}</span>
      <span className="sr-only"> (press and hold)</span>
    </button>
  );
}
