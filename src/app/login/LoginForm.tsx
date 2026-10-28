"use client";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";

export function LoginForm({ next }: { next: string }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setState("sending");
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
    const { error } = await supabaseBrowser().auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo } });
    if (error) { setError(error.message); setState("idle"); return; }
    setState("sent");
  }

  if (state === "sent") {
    return (
      <div className="notice ok">
        Sign-in link sent to <strong>{email}</strong>. Open it on this device to continue. It can take a minute to arrive; check spam if it doesn&apos;t.
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="panel">
      {error && <div className="notice error">{error}</div>}
      <div className="field">
        <label htmlFor="email">Email</label>
        <input id="email" type="email" required autoComplete="email" inputMode="email"
          value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
      </div>
      <button className="btn btn-primary" type="submit" disabled={state === "sending"}>
        {state === "sending" ? "Sending link…" : "Send sign-in link"}
      </button>
    </form>
  );
}
