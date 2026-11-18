"use client";
// Player page: the team's manager puts the player on (or takes him off) the trade block.
// Shows in Discord's #trade-block and /tradeblock.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "./Toaster";

export function TradeBlockToggle({ slug, playerId, onManual, onMadden, note, max }: { slug: string; playerId: number; onManual: boolean; onMadden: boolean; note?: string; max: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState(note || "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const save = async (on: boolean) => {
    setBusy(true); setMsg("");
    const res = await fetch(`/api/leagues/${slug}/trade-block`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ playerId, on, note: val }),
    }).catch(() => null);
    const j = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res?.ok) { setMsg(j.error || "Couldn't save. Try again."); return; }
    setOpen(false);
    toast(on ? "On the trade block" : "Off the trade block");
    router.refresh();
  };

  if (!open) {
    return (
      <button type="button" className="btn-link nick-open" onClick={() => setOpen(true)}>
        {onManual ? `On the trade block${note ? `: "${note}"` : ""} · Change` : onMadden ? "On Madden's trade block · Add a note" : "Put on the trade block"}
      </button>
    );
  }
  return (
    <form className="nick-form" onSubmit={(e) => { e.preventDefault(); save(true); }}>
      <label htmlFor="block-in">Trade block note <span className="muted small">(optional: what you want back; posts in Discord)</span></label>
      <div className="nick-row">
        <input id="block-in" type="text" value={val} maxLength={max} autoFocus placeholder="e.g. a 2nd round pick or a CB" onChange={(e) => setVal(e.target.value)} disabled={busy} />
        <button type="submit" className="btn" disabled={busy}>{busy ? "Saving…" : onManual ? "Save" : "Add"}</button>
      </div>
      <div className="nick-actions">
        {onManual && <button type="button" className="btn-link" disabled={busy} onClick={() => save(false)}>Take off the block</button>}
        <button type="button" className="btn-link" disabled={busy} onClick={() => { setOpen(false); setVal(note || ""); setMsg(""); }}>Cancel</button>
      </div>
      {onMadden && <p className="muted small">He&apos;s on the block in Madden too; he stays listed until he&apos;s off it there.</p>}
      {msg && <p className="error small">{msg}</p>}
    </form>
  );
}
