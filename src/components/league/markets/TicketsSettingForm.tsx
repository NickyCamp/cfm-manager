"use client";
// Commissioner switch on the Markets setup page: bet play money or the server's UnbelievaBoat currency.
import { useRouter } from "next/navigation";
import { useState } from "react";

export function TicketsSettingForm({ slug, enabled, field }: { slug: string; enabled: boolean; field: "cash" | "bank" }) {
  const router = useRouter();
  const [on, setOn] = useState(enabled);
  const [f, setF] = useState(field);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(slug)}/markets/settings`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tickets: on, field: f }) });
      const j = await res.json().catch(() => ({}));
      setMsg(res.ok ? { ok: true, text: j.text } : { ok: false, text: j.error || "Couldn't save that." });
      if (res.ok) router.refresh();
    } catch { setMsg({ ok: false, text: "Couldn't reach the server." }); }
    finally { setBusy(false); }
  };
  return (
    <form className="mk-setup-form" onSubmit={(e) => { e.preventDefault(); save(); }}>
      <label><input type="radio" name="cur" checked={!on} onChange={() => setOn(false)} /> Play money (everyone starts with $1,000 each season)</label>
      <label><input type="radio" name="cur" checked={on} onChange={() => setOn(true)} /> The server&apos;s UnbelievaBoat currency, from members&apos;{" "}
        <select value={f} onChange={(e) => setF(e.target.value === "bank" ? "bank" : "cash")} aria-label="Which UnbelievaBoat balance" disabled={!on}>
          <option value="cash">cash</option><option value="bank">bank</option>
        </select> balance
      </label>
      <p className="hint small">Switching starts a separate book: open bets in the other currency stay where they are and still settle.</p>
      <button type="submit" className="btn" disabled={busy || (on === enabled && f === field)}>Save</button>
      {msg && <p className={`mk-msg ${msg.ok ? "ok" : "err"}`} role="status">{msg.text}</p>}
    </form>
  );
}
