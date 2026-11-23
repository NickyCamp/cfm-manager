"use client";
// Live tab multiview (Nick, 2026-11-22): a box of every live stream. Click "Watch" to put one on the big screen
// alone, "+ Add" to watch several at once (side by side, then 2×2, then 3 across). Nothing switches on its own.
// Only one player has sound at a time (browsers start embeds muted; turning sound on reloads that player).
import { useEffect, useMemo, useState } from "react";
import { embedSrc, NAME, since, type LiveItem } from "./LiveGrid";

const key = (i: LiveItem) => `${i.teamId}:${i.platform}:${i.channel}`;

export function MultiView({ items }: { items: LiveItem[] }) {
  const [host, setHost] = useState("");
  useEffect(() => setHost(window.location.hostname), []);
  const byKey = useMemo(() => new Map(items.map((i) => [key(i), i])), [items]);
  // start on the most-watched stream
  const [watching, setWatching] = useState<string[]>(() => {
    const top = [...items].sort((a, b) => (b.viewers ?? 0) - (a.viewers ?? 0))[0];
    return top ? [key(top)] : [];
  });
  const [sound, setSound] = useState<string | null>(null);

  // streams that ended drop out; if nothing's left, show the first one still live
  const shown = watching.filter((k) => byKey.has(k));
  const view = shown.length ? shown : items.length ? [key(items[0])] : [];

  const solo = (k: string) => { setWatching([k]); setSound(k); };
  const toggle = (k: string) => setWatching((w) => (w.includes(k) ? w.filter((x) => x !== k) : [...w.filter((x) => byKey.has(x)), k]));
  const all = () => setWatching(items.map(key));

  return (
    <section className="mv">
      <div className="mv-bar">
        <span className="mv-count"><span className="live-pill">● {items.length} live</span></span>
        <span className="muted small">{view.length > 1 ? `Watching ${view.length} at once` : "Pick a game below, or add more to watch them together"}</span>
        <span className="mv-tools">
          {items.length > 1 && view.length < items.length && <button type="button" className="btn-link" onClick={all}>Watch all</button>}
          {view.length > 1 && <button type="button" className="btn-link" onClick={() => setWatching([view[0]])}>Just one</button>}
        </span>
      </div>

      <div className="mv-view" data-n={Math.min(view.length, 5)}>
        {view.map((k) => {
          const i = byKey.get(k)!;
          const loud = sound === k;
          const src = host ? embedSrc(i, host, !loud) : "";
          return (
            <article key={k} className="mv-player" style={{ borderTopColor: i.primary }}>
              <div className="live-frame">
                {src ? <iframe key={`${k}:${loud}`} src={src} title={`${i.team} live on ${NAME[i.platform]}`} allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowFullScreen />
                  : <div className="live-frame-empty muted">Loading player…</div>}
              </div>
              <div className="live-meta">
                <div className="live-head">
                  <strong>{i.abbr}</strong>
                  {i.game && <span className="muted">{i.game.label}{i.game.final ? " (final)" : ""}</span>}
                  <span className="muted live-right">{i.viewers != null ? `${i.viewers.toLocaleString()} watching` : ""}{i.startedAt ? ` · ${since(i.startedAt)}` : ""}</span>
                </div>
                {i.title && view.length <= 2 && <div className="live-title">{i.title}</div>}
                <div className="small muted mv-actions">
                  <span>{i.user} · <a href={i.url} target="_blank" rel="noopener noreferrer">{NAME[i.platform]} ↗</a></span>
                  <span className="mv-btns">
                    <button type="button" className="btn-link" onClick={() => setSound(loud ? null : k)}>{loud ? "🔇 Mute" : "🔊 Sound"}</button>
                    {view.length > 1 && <button type="button" className="btn-link" onClick={() => setWatching(view.filter((x) => x !== k))}>✕ Close</button>}
                  </span>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {items.length > 1 && (
        <div className="mv-box">
          {items.map((i) => {
            const k = key(i);
            const on = view.includes(k);
            const src = host && !on ? embedSrc(i, host, true) : "";
            return (
              <div key={k} className={`mv-tile${on ? " on" : ""}`} style={{ borderTopColor: i.primary }}>
                <div className="live-frame">
                  {on ? <div className="live-frame-empty mv-onair">Watching</div>
                    : src ? <iframe src={src} title={`${i.team} preview`} allow="autoplay; encrypted-media" loading="lazy" tabIndex={-1} />
                      : <div className="live-frame-empty muted">…</div>}
                </div>
                <div className="mv-cap">
                  <span className="mv-cap-name"><strong>{i.abbr}</strong> {i.game?.label ?? ""}<span className="muted">{i.viewers != null ? ` · ${i.viewers.toLocaleString()}` : ""}</span></span>
                  <span className="mv-btns">
                    {!(on && view.length === 1) && <button type="button" className="btn-link" onClick={() => solo(k)}>Watch</button>}
                    {on ? (view.length > 1 && <button type="button" className="btn-link" onClick={() => toggle(k)}>Remove</button>)
                      : <button type="button" className="btn-link" onClick={() => toggle(k)}>+ Add</button>}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
