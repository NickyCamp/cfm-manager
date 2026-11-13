"use client";
// Sign-in links from Supabase's standard email land here with the session in
// the URL fragment (#access_token=...). That works in any browser, including a
// mail app's built-in one, unlike the PKCE "?code=" flow.
import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { safeNext } from "@/lib/safeNext";

export function FinishSignIn() {
  const params = useSearchParams();
  const [error, setError] = useState("");

  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const access_token = hash.get("access_token"), refresh_token = hash.get("refresh_token");
    const next = safeNext(params.get("next"));
    if (!access_token || !refresh_token) {
      const why = hash.get("error_description") || params.get("error_description");
      setError(why && /expired|invalid/i.test(why) ? "That sign-in link has expired or was already used." : why || "That sign-in link didn't work.");
      return;
    }
    const stop = setTimeout(() => setError("Signing in is taking too long."), 15000);
    fetch("/auth/finish/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ access_token, refresh_token }),
    })
      .then(async (res) => {
        const out = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(/expired|invalid/i.test(out.error || "") ? "That sign-in link has expired or was already used." : out.error || "That sign-in link didn't work.");
        clearTimeout(stop);
        // Full page load so every part of the app sees the new sign-in cookies.
        window.location.replace(next);
      })
      .catch((err: Error) => { clearTimeout(stop); setError(err.message); });
    return () => clearTimeout(stop);
  }, [params]);

  if (!error) return <p className="muted">One moment.</p>;
  return <div className="notice error">{error} <Link href="/login">Send yourself a new one.</Link></div>;
}
