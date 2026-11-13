// POST /api/leagues/<slug>/leave — removes the league from the user's
// "My leagues". The league itself stays (its site, data, card art and Discord
// links keep working for everyone else); adding it again from /connect rejoins.
// If the user owned it and others are members, ownership passes to the
// longest-standing member.
import { NextResponse } from "next/server";
import { currentUser, supabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const admin = supabaseAdmin();
  const { data: lg } = await admin.from("leagues").select("id, owner_id").eq("slug", slug).maybeSingle();
  if (!lg) return NextResponse.json({ error: "No such league." }, { status: 404 });

  const { error } = await admin.from("league_members").delete().eq("league_id", lg.id).eq("user_id", user.id);
  if (error) return NextResponse.json({ error: `Couldn't remove it: ${error.message}` }, { status: 500 });

  if (lg.owner_id === user.id) {
    const { data: heir } = await admin
      .from("league_members").select("user_id")
      .eq("league_id", lg.id).order("joined_at", { ascending: true }).limit(1).maybeSingle();
    if (heir) {
      await admin.from("leagues").update({ owner_id: heir.user_id }).eq("id", lg.id);
      await admin.from("league_members").update({ role: "commissioner" }).eq("league_id", lg.id).eq("user_id", heir.user_id);
    }
  }
  return NextResponse.json({ ok: true });
}
