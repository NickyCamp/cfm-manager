"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { StaticCard, type PlayerCardProps } from "./CardFront";

type Item = { href: string; card: PlayerCardProps };

/** A hand of cards: swipe (or use the arrows) to send the top card to the back; tap it to open the player. */
export function CardStack({ items, label }: { items: Item[]; label: string }) {
  const router = useRouter();
  const [order, setOrder] = useState(() => items.map((_, i) => i));
  const [dx, setDx] = useState(0);
  const [leaving, setLeaving] = useState<0 | 1 | -1>(0);
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  if (!items.length) return null;

  const cycle = (dir: 1 | -1) => {
    if (leaving) return;
    if (dir === 1) {
      setLeaving(1);
      setTimeout(() => { setOrder((o) => [...o.slice(1), o[0]]); setLeaving(0); setDx(0); }, 220);
    } else {
      setOrder((o) => [o[o.length - 1], ...o.slice(0, -1)]);
      setDx(0);
    }
  };

  const top = order[0];
  return (
    <section className="cstack" aria-label={label}>
      <div className="cstack-cards"
        onPointerDown={(e) => { start.current = { x: e.clientX, y: e.clientY, id: e.pointerId }; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); }}
        onPointerMove={(e) => { if (start.current) setDx(e.clientX - start.current.x); }}
        onPointerUp={(e) => {
          const s = start.current; start.current = null;
          if (!s) return;
          const moved = e.clientX - s.x;
          if (Math.abs(moved) < 8 && Math.abs(e.clientY - s.y) < 8) { setDx(0); router.push(items[top].href); return; }
          if (Math.abs(moved) > 70) cycle(moved < 0 ? 1 : -1); else setDx(0);
        }}
        onPointerCancel={() => { start.current = null; setDx(0); }}
      >
        {order.slice(0, 4).map((idx, pos) => {
          const isTop = pos === 0;
          const shift = isTop ? (leaving ? -420 : dx) : 0;
          const style: React.CSSProperties = {
            zIndex: 10 - pos,
            transform: `translate(${shift + pos * 10}px, ${pos * 6}px) rotate(${isTop ? shift / 18 : pos * 2.5}deg) scale(${1 - pos * 0.04})`,
            transition: isTop && dx && !leaving ? "none" : "transform .25s ease",
            opacity: isTop && leaving ? 0 : 1,
          };
          return (
            <div key={idx} className="cstack-card" style={style} aria-hidden={!isTop}>
              <StaticCard {...items[idx].card} />
            </div>
          );
        })}
      </div>
      <div className="cstack-ctrl">
        <button type="button" className="pcard-flip" onClick={() => cycle(-1)} aria-label="Previous player">‹</button>
        <span className="muted small">{items[top].card.first} {items[top].card.last} · {top + 1} of {items.length}</span>
        <button type="button" className="pcard-flip" onClick={() => cycle(1)} aria-label="Next player">›</button>
      </div>
    </section>
  );
}
