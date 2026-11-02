"use client";

import { useEffect, useRef, useState } from "react";

type Toast = { id: number; text: string; tone: "ok" | "error" };
const EVT = "cfm-toast";

/** Show a toast from anywhere in the client: toast("Card art saved"). */
export function toast(text: string, tone: Toast["tone"] = "ok") {
  window.dispatchEvent(new CustomEvent(EVT, { detail: { text, tone } }));
}

/** Bottom-of-screen toasts. They leave on their own after a few seconds, or swipe one sideways. */
export function Toaster() {
  const [list, setList] = useState<Toast[]>([]);
  const next = useRef(1);
  useEffect(() => {
    const on = (e: Event) => {
      const { text, tone } = (e as CustomEvent).detail as Omit<Toast, "id">;
      const id = next.current++;
      setList((l) => [...l.slice(-2), { id, text, tone }]);
      setTimeout(() => setList((l) => l.filter((t) => t.id !== id)), 4500);
    };
    window.addEventListener(EVT, on);
    return () => window.removeEventListener(EVT, on);
  }, []);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {list.map((t) => <SwipeToast key={t.id} t={t} onGone={() => setList((l) => l.filter((x) => x.id !== t.id))} />)}
    </div>
  );
}

function SwipeToast({ t, onGone }: { t: Toast; onGone: () => void }) {
  const [dx, setDx] = useState(0);
  const start = useRef<number | null>(null);
  return (
    <div className={`toast ${t.tone}`} style={{ transform: `translateX(${dx}px)`, opacity: 1 - Math.min(1, Math.abs(dx) / 200), transition: start.current === null ? "transform .2s, opacity .2s" : "none" }}
      onPointerDown={(e) => { start.current = e.clientX; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); }}
      onPointerMove={(e) => { if (start.current !== null) setDx(e.clientX - start.current); }}
      onPointerUp={() => { start.current = null; if (Math.abs(dx) > 90) onGone(); else setDx(0); }}
      onPointerCancel={() => { start.current = null; setDx(0); }}>
      {t.text}
    </div>
  );
}
