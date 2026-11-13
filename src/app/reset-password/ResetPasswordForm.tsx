"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";

export function ResetPasswordForm() {
  const router = useRouter();
  const [ready, setReady] = useState<"checking" | "yes" | "no">("checking");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    supabaseBrowser().auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? "");
      setReady(data.user ? "yes" : "no");
    });
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password !== confirm) { setError("The two passwords don't match."); return; }
    setBusy(true);
    try {
      const { error } = await supabaseBrowser().auth.updateUser({ password });
      if (error) throw error;
      setDone(true);
      setTimeout(() => { router.replace("/dashboard"); router.refresh(); }, 1200);
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

  if (ready === "checking") return <p className="muted">One moment.</p>;
  if (ready === "no") {
    return (
      <div className="notice error">
        This reset link has expired or was already used. <Link href="/login">Request a new one</Link> from the Forgot password tab.
      </div>
    );
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
