"use client";
// Sign-in links from Supabase's standard email land here with the session in
// the URL fragment (#access_token=...). That works in any browser, including a
// mail app's built-in one, unlike the PKCE "?code=" flow.
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { safeNext } from "@/lib/safeNext";

export function FinishSignIn() {
  const router = useRouter();
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
    supabaseBrowser().auth.setSession({ access_token, refresh_token }).then(({ error }) => {
      if (error) { setError(error.message); return; }
      window.history.replaceState(null, "", window.location.pathname);
      router.replace(next);
      router.refresh();
    });
  }, [params, router]);

  if (!error) return <p className="muted">One moment.</p>;
  return <div className="notice error">{error} <Link href="/login">Send yourself a new one.</Link></div>;
}
