"use client";
import { useState } from "react";

export function SyncNowButton({ slug }: { slug: string }) {
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [msg, setMsg] = useState("");
  async function go() {
    setState("busy");
    const res = await fetch(`/api/leagues/${slug}/sync`, { method: "POST" }).catch(() => null);
    const body = res ? await res.json().catch(() => ({})) : {};
    setMsg(body.message || body.error || "Couldn't reach the server.");
    setState("done");
  }
  return (
    <span className="sync-now">
      <button type="button" className="btn-link" onClick={go} disabled={state === "busy"}>{state === "busy" ? "Starting…" : "Sync now"}</button>
      {state === "done" && <span className="sync-msg" role="status">{msg}</span>}
    </span>
  );
}
