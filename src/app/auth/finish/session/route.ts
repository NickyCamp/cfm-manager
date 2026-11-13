// Saves the session from an emailed link (tokens read from the URL fragment by
// /auth/finish) into the sign-in cookies. Done on the server: the browser
// Supabase client could hang here because it also tries to read the fragment.
import { NextResponse } from "next/server";
import { supabaseUser } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const access_token = String(body.access_token || ""), refresh_token = String(body.refresh_token || "");
  if (!access_token || !refresh_token) return NextResponse.json({ error: "missing tokens" }, { status: 400 });
  const sb = await supabaseUser();
  const { error } = await sb.auth.setSession({ access_token, refresh_token });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
