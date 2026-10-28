import { NextResponse } from "next/server";
import { supabaseUser } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const sb = await supabaseUser();
  await sb.auth.signOut();
  return NextResponse.redirect(new URL("/", request.url), { status: 303 });
}
