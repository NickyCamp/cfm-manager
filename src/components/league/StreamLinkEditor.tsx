"use client";
// Live tab: the team's manager (or an admin) sets the Twitch / Kick / YouTube link for the team.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "./Toaster";

export function StreamLinkEditor({ slug, teamId, current }: { slug: string; teamId: number; current: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState(current);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const save = async (url: string) => {
    setBusy(true); setMsg("");
    const res = await fetch(`/api/leagues/${slug}/stream/${teamId}`, {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }),
    }).catch(() => null);
    const j = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res?.ok) { setMsg(j.error || "Couldn't save. Try again."); return; }
    setVal(j.url || ""); setOpen(false);
    toast(j.url ? "Stream link saved" : "Stream link removed");
    router.refresh();
  };

  if (!open) {
    return (
      <div><button type="button" className="btn-link" onClick={() => setOpen(true)}>{current ? "Change" : "Add your stream link"}</button></div>
    );
  }
  return (
    <form className="nick-form" onSubmit={(e) => { e.preventDefault(); save(val); }}>
      <div className="nick-row">
        <input type="url" inputMode="url" value={val} autoFocus placeholder="twitch.tv/yourname" onChange={(e) => setVal(e.target.value)} disabled={busy} aria-label="Stream link" />
        <button type="submit" className="btn" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
      </div>
      <div className="nick-actions">
        {current && <button type="button" className="btn-link" disabled={busy} onClick={() => save("")}>Remove</button>}
        <button type="button" className="btn-link" disabled={busy} onClick={() => { setOpen(false); setVal(current); setMsg(""); }}>Cancel</button>
      </div>
      {msg && <p className="error small">{msg}</p>}
    </form>
  );
}
