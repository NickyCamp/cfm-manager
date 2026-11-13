"use client";
import { useState } from "react";

export function ResetPasswordForm({ email }: { email: string }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password !== confirm) { setError("The two passwords don't match."); return; }
    setBusy(true);
    try {
      const res = await fetch("/reset-password/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const out = await res.json().catch(() => ({}));
      if (res.status === 401) throw new Error("Your reset link has expired. Request a new one from the Forgot password tab on the sign-in page.");
      if (!res.ok) throw new Error(out.error || "Couldn't save the password.");
      setDone(true);
      setTimeout(() => window.location.replace("/dashboard"), 1200);
    } catch (err) {
      const m = (err as Error).message;
      setError(
        /different from the old/i.test(m) ? "Pick a password you haven't used here before."
        : /characters|weak|short/i.test(m) ? "Pick a longer password (at least 8 characters)."
        : m,
      );
    } finally {
      setBusy(false);
    }
  }

  if (done) return <div className="notice ok">Password updated. Taking you to your leagues…</div>;

  return (
    <form onSubmit={submit} className="panel">
      {email && <p className="hint">For <strong>{email}</strong></p>}
      {error && <div className="notice error" role="alert">{error}</div>}
      <div className="field">
        <label htmlFor="password">New password</label>
        <input id="password" type="password" required minLength={8} autoComplete="new-password"
          value={password} onChange={(e) => setPassword(e.target.value)} />
        <div className="hint">At least 8 characters.</div>
      </div>
      <div className="field">
        <label htmlFor="confirm">Type it again</label>
        <input id="confirm" type="password" required minLength={8} autoComplete="new-password"
          value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </div>
      <button className="btn btn-primary" type="submit" disabled={busy}>
        {busy ? "One moment…" : "Save new password"}
      </button>
    </form>
  );
}
