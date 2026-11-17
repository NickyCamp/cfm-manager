// POST /api/leagues/<slug>/leave — removes the league from the user's
// "My leagues" and from every place it was theirs: their membership, and their
// Discord /myleague pick (so /league and DMs stop showing it too).
// The league itself stays (its site, data, card art and Discord links keep
// working for everyone else); adding it again from /connect rejoins.
// If the user owned it and others are members, ownership passes to the
// longest-standing member. If nobody is left, the league is marked orphaned:
// it stops syncing, and the sync worker deletes it (data, art, everything) after
// 30 days unless someone adds it again (Nick, 2026-11-14).
import { NextResponse } from "next/server";
import { currentUser, supabaseAdmin } from "@/lib/supabase/server";
import { updateLeagueSettings } from "@/lib/leagueSettings";

export const runtime = "nodejs";

export async function POST(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const admin = supabaseAdmin();
  const { data: lg } = await admin.from("leagues").select("id, owner_id, settings").eq("slug", slug).maybeSingle();
  if (!lg) return NextResponse.json({ error: "No such league." }, { status: 404 });

  const { data: removed, error } = await admin.from("league_members").delete().eq("league_id", lg.id).eq("user_id", user.id).select("user_id");
  if (error) return NextResponse.json({ error: `Couldn't remove it: ${error.message}` }, { status: 500 });
  // Someone who was never in this league changes nothing: without this, any signed-in account could
  // start the 30-day delete clock on a league that has no member rows.
  if (!removed?.length && lg.owner_id !== user.id) return NextResponse.json({ ok: true, orphaned: false });

  const { data: heir } = await admin
    .from("league_members").select("user_id")
    .eq("league_id", lg.id).order("joined_at", { ascending: true }).limit(1).maybeSingle();
  if (lg.owner_id === user.id && heir) {
    await admin.from("leagues").update({ owner_id: heir.user_id }).eq("id", lg.id);
    await admin.from("league_members").update({ role: "commissioner" }).eq("league_id", lg.id).eq("user_id", heir.user_id);
  }

  // Their Discord /myleague pick goes too, and with nobody left the 30-day clock starts.
  const discordId = (user.app_metadata as { discord_id?: string } | undefined)?.discord_id;
  await updateLeagueSettings(lg.id, (settings) => {
    let changed = false;
    if (discordId && Array.isArray(settings.discordUsers)) {
      const users = (settings.discordUsers as string[]).filter((u) => u !== String(discordId));
      if (users.length !== settings.discordUsers.length) {
        if (users.length) settings.discordUsers = users; else delete settings.discordUsers;
        changed = true;
      }
    }
    if (!heir && !settings.orphanedAt) { settings.orphanedAt = new Date().toISOString(); changed = true; }
    return changed ? settings : null;
  });

  return NextResponse.json({ ok: true, orphaned: !heir });
}
