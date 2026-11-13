"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { supabaseBrowser } from "@/lib/supabase/browser";

type Mode = "signin" | "signup" | "link" | "reset";

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [code, setCode] = useState("");

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const { error } = await supabaseBrowser().auth.verifyOtp({ email, token: code.replace(/\D/g, ""), type: "email" });
      if (error) throw error;
      router.replace(next);
      router.refresh();
    } catch (err) {
      const m = (err as Error).message;
      setError(/expired|invalid/i.test(m) ? "That code didn't work. It may have expired or been mistyped; check the newest email or send a new one." : m);
    } finally {
      setBusy(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const sb = supabaseBrowser();
    // Implicit flow: emailed links carry the session themselves, so they work in
    // any browser (PKCE links only work where they were requested).
    const linkClient = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { flowType: "implicit", persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    try {
      if (mode === "reset") {
        // The link signs them in (via /auth/callback → /auth/finish), then lands on
        // /reset-password to choose a new password.
        const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent("/reset-password")}`;
        const { error } = await linkClient().auth.resetPasswordForEmail(email, { redirectTo });
        if (error) throw error;
        setSent(true);
        return;
      }
      if (mode === "link") {
        const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
        const { error } = await linkClient().auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo, shouldCreateUser: true } });
        if (error) throw error;
        setSent(true);
        return;
      }
      const { data, error } = mode === "signup"
        ? await sb.auth.signUp({ email, password, options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` } })
        : await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
      if (!data.session) { setSent(true); return; } // email confirmation is switched on in Supabase
      router.replace(next);
      router.refresh();
    } catch (err) {
      setError(friendly((err as Error).message, mode));
    } finally {
      setBusy(false);
    }
  }

  if (sent && mode === "reset") {
    return (
      <div className="panel">
        <div className="notice ok">
          If there&apos;s an account for <strong>{email}</strong>, we&apos;ve emailed it a link to reset the password. Tap the link, then choose a new password. It can take a minute; check spam if it doesn&apos;t show up.
        </div>
        <p className="hint" style={{ marginTop: 14 }}>
          <a href="#" onClick={(e) => { e.preventDefault(); setSent(false); setMode("signin"); }}>Back to sign in</a>
        </p>
      </div>
    );
  }

  if (sent) {
    return (
      <form onSubmit={verifyCode} className="panel">
        <div className="notice ok">
          We emailed <strong>{email}</strong>. Tap the link in it; it works on any device or app. It can take a minute; check spam if it doesn&apos;t show up. If the email shows a code instead, type it below.
        </div>
        {error && <div className="notice error" role="alert">{error}</div>}
        <div className="field">
          <label htmlFor="code">Code from the email</label>
          <input id="code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]*" maxLength={12} required
            value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" />
        </div>
        <button className="btn btn-primary" type="submit" disabled={busy || code.replace(/\D/g, "").length < 6}>
          {busy ? "One moment…" : "Sign in"}
        </button>
        <p className="hint" style={{ marginTop: 14 }}>
          <a href="#" onClick={(e) => { e.preventDefault(); setSent(false); setCode(""); setError(""); }}>Use a different email or send a new code</a>
        </p>
      </form>
    );
  }

  return (
    <form onSubmit={submit} className="panel">
      <div className="tabs" role="tablist" aria-label="Sign in or create an account">
        {([["signin", "Sign in"], ["signup", "Create account"], ["reset", "Forgot password"]] as const).map(([m, label]) => (
          <a key={m} href="#" role="tab" aria-selected={mode === m} aria-current={mode === m ? "page" : undefined}
            onClick={(e) => { e.preventDefault(); setMode(m); setError(""); }}>{label}</a>
        ))}
      </div>
      {error && <div className="notice error" role="alert">{error}</div>}
      <div className="field">
        <label htmlFor="email">Email</label>
        <input id="email" type="email" required autoComplete="email" inputMode="email"
          value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
      </div>
      {mode === "reset" && <p className="hint">Enter the email you signed up with and we&apos;ll send you a link to choose a new password.</p>}
      {(mode === "signin" || mode === "signup") && (
        <div className="field">
          <label htmlFor="password">Password</label>
          <input id="password" type="password" required minLength={8}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            value={password} onChange={(e) => setPassword(e.target.value)} />
          {mode === "signup" && <div className="hint">At least 8 characters.</div>}
        </div>
      )}
      <button className="btn btn-primary" type="submit" disabled={busy}>
        {busy ? "One moment…" : mode === "signup" ? "Create account" : mode === "reset" ? "Email me a reset link" : mode === "link" ? "Email me a sign-in link" : "Sign in"}
      </button>
      <p className="hint" style={{ marginTop: 14 }}>
        {mode === "reset" ? (
          <a href="#" onClick={(e) => { e.preventDefault(); setMode("signin"); setError(""); }}>Back to sign in</a>
        ) : mode === "link" ? (
          <a href="#" onClick={(e) => { e.preventDefault(); setMode("signin"); }}>Use a password instead</a>
        ) : (
          <a href="#" onClick={(e) => { e.preventDefault(); setMode("link"); }}>Email me a sign-in link instead</a>
        )}
      </p>
    </form>
  );
}

function friendly(msg: string, mode: Mode) {
  if (/invalid login credentials/i.test(msg)) return "That email and password don't match. Forgot it? Use the Forgot password tab to set a new one.";
  if (/already registered/i.test(msg)) return "There's already an account with that email. Sign in instead.";
  if (/rate limit|too many/i.test(msg)) return mode === "reset" ? "Too many emails were sent recently. Try again in a little while." : mode === "link" ? "Too many sign-in emails were sent recently. Try again in a little while, or use a password." : "Too many attempts. Wait a minute and try again.";
  if (/password/i.test(msg) && /characters|weak|short/i.test(msg)) return "Pick a longer password (at least 8 characters).";
  return msg;
}
