"use client";
import { useState } from "react";
import { toast } from "./Toaster";

export function SyncNowButton({ slug }: { slug: string }) {
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  async function go() {
    setState("busy");
    const res = await fetch(`/api/leagues/${slug}/sync`, { method: "POST" }).catch(() => null);
    const body = res ? await res.json().catch(() => ({})) : {};
    const m = body.message || body.error || "Couldn't reach the server.";
    toast(m, res?.ok ? "ok" : "error");
    setState("done");
  }
  return (
    <span className="sync-now">
      <button type="button" className="btn-link" onClick={go} disabled={state === "busy"}>{state === "busy" ? "Starting…" : "Sync now"}</button>
    </span>
  );
}
