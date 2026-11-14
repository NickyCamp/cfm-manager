import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { isCommissioner, viewer } from "@/lib/marketStore";

// POST { tickets: boolean, field: "cash" | "bank" } — the league's commissioner turns betting in
// UnbelievaBoat Tickets on or off (leagues.settings.tickets). See /l/<slug>/markets/setup.
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const v = await viewer(slug);
  if (!v.userId) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!v.leagueId || !(await isCommissioner(v.leagueId, v.userId))) return NextResponse.json({ error: "Only the league's commissioner can change this." }, { status: 403 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (typeof body?.tickets !== "boolean") return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const field = body.field === "bank" ? "bank" : "cash";
  const db = supabaseAdmin();
  const { data } = await db.from("leagues").select("settings").eq("id", v.leagueId).single();
  const settings = { ...((data?.settings as Record<string, unknown>) || {}), tickets: { enabled: body.tickets, field } };
  const { error } = await db.from("leagues").update({ settings }).eq("id", v.leagueId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, text: body.tickets ? `Tickets betting is on (members' UnbelievaBoat ${field} balance).` : "Tickets betting is off: the markets use play money." });
}
