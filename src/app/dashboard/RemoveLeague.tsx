"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function RemoveLeague({ slug, name }: { slug: string; name: string }) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function remove() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/leagues/${slug}/leave`, { method: "POST" });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || "Couldn't remove it.");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  if (!asking) {
    return <button type="button" className="btn btn-quiet" onClick={() => setAsking(true)}>Remove</button>;
  }
  return (
    <div className="remove-league">
      <span>Remove {name} from your leagues? The league&apos;s site stays up for everyone else, and you can add it again anytime.</span>
      {error && <span className="notice error">{error}</span>}
      <span className="remove-league-btns">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={remove}>{busy ? "Removing…" : "Yes, remove"}</button>
        <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => setAsking(false)}>Cancel</button>
      </span>
    </div>
  );
}
