// Where the sign-in email link lands.
// - token_hash links (our email template): send to /auth/confirm, which asks
//   for a tap before using the link, so email scanners that pre-open links
//   can't use it up. Works in any browser, including in-app ones on phones.
// - code links (PKCE flow): only work in the browser that asked for the
//   email; kept for old emails.
// - fragment links (implicit flow, what the login form requests now):
//   handed to /auth/finish in the browser.
import { NextResponse } from "next/server";
import { supabaseUser } from "@/lib/supabase/server";
import { safeNext } from "@/lib/safeNext";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const next = safeNext(url.searchParams.get("next"));
  const tokenHash = url.searchParams.get("token_hash");
  if (tokenHash) {
    const to = new URL("/auth/confirm", url.origin);
    to.searchParams.set("token_hash", tokenHash);
    to.searchParams.set("type", url.searchParams.get("type") || "email");
    to.searchParams.set("next", next);
    return NextResponse.redirect(to);
  }
  const code = url.searchParams.get("code");
  if (code) {
    const sb = await supabaseUser();
    const { error } = await sb.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, url.origin));
    return NextResponse.redirect(new URL("/login?error=link", url.origin));
  }
  // No code: the session (or an error) is in the URL fragment, which the
  // browser keeps across this redirect. /auth/finish reads it.
  const finish = new URL("/auth/finish", url.origin);
  finish.searchParams.set("next", next);
  const err = url.searchParams.get("error_description");
  if (err) finish.searchParams.set("error_description", err);
  return NextResponse.redirect(finish);
}
