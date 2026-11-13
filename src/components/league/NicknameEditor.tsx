"use client";
// Player page: the team's manager sets the nickname shown with this player's name
// on the Discord bot, his card and this page.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "./Toaster";

export function NicknameEditor({ slug, playerId, current, max }: { slug: string; playerId: number; current?: string; max: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState(current || "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const save = async (nickname: string) => {
    setBusy(true); setMsg("");
    const res = await fetch(`/api/leagues/${slug}/nickname/${playerId}`, {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ nickname }),
    }).catch(() => null);
    const j = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res?.ok) { setMsg(j.error || "Couldn't save. Try again."); return; }
    setVal(j.nickname || ""); setOpen(false);
    toast(j.nickname ? "Nickname saved" : "Nickname removed");
    router.refresh();
  };

  if (!open) {
    return (
      <button type="button" className="btn-link nick-open" onClick={() => setOpen(true)}>
        {current ? `Nickname: "${current}" · Change` : "Add a nickname"}
      </button>
    );
  }
  return (
    <form className="nick-form" onSubmit={(e) => { e.preventDefault(); save(val); }}>
      <label htmlFor="nick-in">Nickname <span className="muted small">(shows on Discord and his card)</span></label>
      <div className="nick-row">
        <input id="nick-in" type="text" value={val} maxLength={max} autoFocus placeholder="e.g. Showtime" onChange={(e) => setVal(e.target.value)} disabled={busy} />
        <button type="submit" className="btn" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
      </div>
      <div className="nick-actions">
        {current && <button type="button" className="btn-link" disabled={busy} onClick={() => save("")}>Remove nickname</button>}
        <button type="button" className="btn-link" disabled={busy} onClick={() => { setOpen(false); setVal(current || ""); setMsg(""); }}>Cancel</button>
      </div>
      {msg && <p className="error small">{msg}</p>}
    </form>
  );
}
