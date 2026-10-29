// Uses a token_hash sign-in link (POST from /auth/confirm) and starts the session.
import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { supabaseUser } from "@/lib/supabase/server";
import { safeNext } from "@/lib/safeNext";

const TYPES: EmailOtpType[] = ["email", "magiclink", "signup", "invite", "recovery", "email_change"];

export async function POST(request: Request) {
  const url = new URL(request.url);
  const form = await request.formData();
  const tokenHash = String(form.get("token_hash") || "");
  const type = String(form.get("type") || "email") as EmailOtpType;
  const next = safeNext(String(form.get("next") || ""));
  if (tokenHash && TYPES.includes(type)) {
    const sb = await supabaseUser();
    const { error } = await sb.auth.verifyOtp({ token_hash: tokenHash, type });
    if (!error) return NextResponse.redirect(new URL(next, url.origin), { status: 303 });
  }
  return NextResponse.redirect(new URL("/login?error=link", url.origin), { status: 303 });
}
