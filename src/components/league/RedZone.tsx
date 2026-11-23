"use client";
// RedZone (Nick, 2026-11-22): one big player plus a strip of every other live stream.
// Who's on the big screen, in order:
//   1. a stream this viewer clicked (until they press "Back to RedZone"),
//   2. the admin host's pick (shared by everyone, polled every 4 s; lapses after 10 min without a pick),
//   3. auto-rotate: every 3 minutes, the same for every viewer (based on the clock).
// The small players stay loaded and muted so switching is quick; the big one reloads (a couple of seconds).
import { useCallback, useEffect, useMemo, useState } from "react";
import type { LiveItem } from "./LiveGrid";
import { embedSrc, NAME, since } from "./LiveGrid";

const ROTATE_MS = 3 * 60_000;
type Host = { teamId: number | null; by: string; active: boolean };

export function RedZone({ slug, items, admin }: { slug: string; items: LiveItem[]; admin: boolean }) {
  const [host, setHost] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [picked, setPicked] = useState<number | null>(null);
  const [hostState, setHostState] = useState<Host>({ teamId: null, by: "", active: false });
  const [hosting, setHosting] = useState(false);
  const [sound, setSound] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => setHost(window.location.hostname), []);
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);

  const poll = useCallback(async () => {
    const r = await fetch(`/api/leagues/${slug}/redzone`, { cache: "no-store" }).catch(() => null);
    if (r?.ok) setHostState(await r.json());
  }, [slug]);
  useEffect(() => {
    poll();
    const id = setInterval(() => { if (document.visibilityState === "visible") poll(); }, 4000);
    return () => clearInterval(id);
  }, [poll]);

  const order = useMemo(() => [...items].sort((a, b) => a.teamId - b.teamId), [items]);
  const byTeam = useMemo(() => new Map(items.map((i) => [i.teamId, i])), [items]);
  const rotateIdx = order.length ? Math.floor(now / ROTATE_MS) % order.length : 0;
  const nextIn = ROTATE_MS - (now % ROTATE_MS);

  let mode: "you" | "host" | "auto" = "auto";
  let featured = order[rotateIdx];
  if (picked != null && byTeam.has(picked)) { mode = "you"; featured = byTeam.get(picked)!; }
  else if (hostState.active && hostState.teamId != null && byTeam.has(hostState.teamId)) { mode = "host"; featured = byTeam.get(hostState.teamId)!; }

  const sendHost = async (teamId: number | null) => {
    setErr("");
    const r = await fetch(`/api/leagues/${slug}/redzone`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ teamId }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    if (!r?.ok) { setErr(j.error || "Couldn't switch. Try again."); return; }
    setHostState(j);
  };

  const choose = (teamId: number) => {
    if (hosting) { setPicked(null); sendHost(teamId); }
    else setPicked(teamId);
  };

  if (!featured) return null;
  const bigSrc = host ? embedSrc(featured, host, !sound) : "";
  const mm = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;

  return (
    <section className="rz">
      <div className="rz-bar">
        <span className="rz-badge">🚨 RedZone</span>
        <span className="rz-status">
          {mode === "you" && <>You picked <strong>{featured.abbr}</strong> · <button type="button" className="btn-link" onClick={() => setPicked(null)}>Back to RedZone</button></>}
          {mode === "host" && <>Hosted by <strong>{hostState.by}</strong></>}
          {mode === "auto" && <>Auto-rotating{order.length > 1 ? ` · next game in ${mm(nextIn)}` : ""}</>}
        </span>
        <span className="rz-tools">
          <button type="button" className="btn-link" onClick={() => setSound((s) => !s)}>{sound ? "🔇 Mute" : "🔊 Sound on"}</button>
          {admin && (hosting
            ? <button type="button" className="btn-link" onClick={() => { setHosting(false); sendHost(null); }}>Stop hosting</button>
            : <button type="button" className="btn-link" onClick={() => { setHosting(true); setPicked(null); sendHost(featured.teamId); }}>Host the RedZone</button>)}
        </span>
      </div>
      {hosting && <p className="small muted rz-hint">You&apos;re hosting: click a game below to put it on everyone&apos;s big screen. Hosting ends after 10 minutes without a switch.</p>}
      {err && <p className="error small">{err}</p>}

      <div className="rz-main" style={{ borderTopColor: featured.primary }}>
        <div className="live-frame">
          {bigSrc ? <iframe key={`${featured.teamId}:${featured.platform}:${featured.channel}:${sound}`} src={bigSrc} title={`${featured.team} live`} allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowFullScreen />
            : <div className="live-frame-empty muted">Loading player…</div>}
        </div>
        <div className="live-meta">
          <div className="live-head">
            <span className="live-pill">● Live</span>
            <strong>{featured.abbr}</strong>
            {featured.game && <span className="muted">{featured.game.label}</span>}
            <span className="muted live-right">{featured.viewers != null ? `${featured.viewers.toLocaleString()} watching` : ""}{featured.startedAt ? ` · ${since(featured.startedAt)}` : ""}</span>
          </div>
          {featured.title && <div className="live-title">{featured.title}</div>}
          <div className="small muted">{featured.user} · <a href={featured.url} target="_blank" rel="noopener noreferrer">Open on {NAME[featured.platform]} ↗</a></div>
        </div>
      </div>

      <div className="rz-strip">
        {order.map((i) => {
          const on = i.teamId === featured.teamId;
          const src = host && !on ? embedSrc(i, host, true) : "";
          return (
            <div key={`${i.teamId}:${i.platform}:${i.channel}`} className={`rz-tile${on ? " on" : ""}`} style={{ borderTopColor: i.primary }}>
              <div className="live-frame">
                {on ? <div className="live-frame-empty rz-onair">On the big screen</div>
                  : src ? <iframe src={src} title={`${i.team} preview`} allow="autoplay; encrypted-media" loading="lazy" tabIndex={-1} />
                    : <div className="live-frame-empty muted">…</div>}
                {!on && <button type="button" className="rz-pick" onClick={() => choose(i.teamId)} aria-label={`Watch ${i.team}`}>{hosting ? "Send to big screen" : "Watch"}</button>}
              </div>
              <div className="rz-cap"><strong>{i.abbr}</strong> {i.game?.label ?? ""}<span className="muted">{i.viewers != null ? ` · ${i.viewers.toLocaleString()}` : ""}</span></div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
