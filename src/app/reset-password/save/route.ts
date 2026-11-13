// Sets a new password for the signed-in user (reached via the reset email).
import { NextResponse } from "next/server";
import { supabaseUser } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const password = String(body.password || "");
  const sb = await supabaseUser();
  const { data } = await sb.auth.getUser();
  if (!data.user) return NextResponse.json({ error: "expired" }, { status: 401 });
  const { error } = await sb.auth.updateUser({ password });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
