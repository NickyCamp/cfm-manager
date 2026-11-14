"use client";
// Set when betting closes on a game (its kickoff). The two teams' managers or a commissioner (checked on the server); every change is public.
import { useRouter } from "next/navigation";
import { useState } from "react";

export function KickoffForm({ slug, gameId, current, canSet, why }: { slug: string; gameId: number; current: string | null; canSet: boolean; why: string }) {
  const router = useRouter();
  const [val, setVal] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const send = async (closeAt: string) => {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(slug)}/markets/close`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ gameId, closeAt }) });
      const j = await res.json().catch(() => ({}));
      setMsg(res.ok ? { ok: true, text: j.text } : { ok: false, text: j.error || "Couldn't save that." });
      if (res.ok) router.refresh();
    } catch { setMsg({ ok: false, text: "Couldn't reach the server." }); }
    finally { setBusy(false); }
  };
  return (
    <div className="mk-kickoff">
      <p className="small">{current ? <>Betting closes <strong>{current}</strong>.</> : "No kickoff set: betting stays open until EA reports the game played."} In Discord: <code>/kickoff team:… time:9pm</code>.</p>
      {canSet ? (
        <form className="mk-kickoff-row" onSubmit={(e) => { e.preventDefault(); if (val) send(new Date(val).toISOString()); }}>
          <input type="datetime-local" value={val} onChange={(e) => setVal(e.target.value)} aria-label="Kickoff time (your time zone)" />
          <button type="submit" className="btn" disabled={busy || !val}>Set kickoff</button>
          <button type="button" className="mk-link-btn danger" disabled={busy} onClick={() => send("now")}>Close betting now</button>
        </form>
      ) : <p className="hint small">{why}</p>}
      {msg && <p className={`mk-msg ${msg.ok ? "ok" : "err"}`} role="status">{msg.text}</p>}
    </div>
  );
}
