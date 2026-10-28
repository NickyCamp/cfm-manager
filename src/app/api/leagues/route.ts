// POST /api/leagues  { connectionId, eaLeagueId, name, slug }
// Adds a league the user picked after connecting EA. If someone already added
// the same league, the user joins it instead of creating a duplicate.

import { NextResponse } from "next/server";
import { currentUser, supabaseAdmin } from "@/lib/supabase/server";
import { RESERVED_SLUGS, SLUG_RE } from "@/lib/slug";
import { triggerSync } from "@/lib/dispatch";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    connectionId?: string; eaLeagueId?: number; name?: string; slug?: string;
  };
  const name = (body.name || "").trim();
  const slug = (body.slug || "").trim().toLowerCase();
  if (!body.connectionId || !body.eaLeagueId) return NextResponse.json({ error: "Pick a league first." }, { status: 400 });
  if (name.length < 2 || name.length > 60) return NextResponse.json({ error: "League name should be 2–60 characters." }, { status: 400 });
  if (!SLUG_RE.test(slug) || RESERVED_SLUGS.has(slug)) {
    return NextResponse.json({ error: "Web address can use lowercase letters, numbers and dashes (3–40 characters)." }, { status: 400 });
  }

  const admin = supabaseAdmin();
  const { data: conn } = await admin
    .from("ea_connections")
    .select("id, user_id, console")
    .eq("id", body.connectionId)
    .single();
  if (!conn || conn.user_id !== user.id) return NextResponse.json({ error: "That EA connection isn't yours. Connect EA again." }, { status: 403 });

  // Already on CFM Manager? Join it.
  const { data: existing } = await admin
    .from("leagues")
    .select("id, slug")
    .eq("ea_league_id", body.eaLeagueId)
    .eq("console", conn.console)
    .maybeSingle();
  if (existing) {
    await admin.from("league_members").upsert({ league_id: existing.id, user_id: user.id }, { onConflict: "league_id,user_id", ignoreDuplicates: true });
    return NextResponse.json({ slug: existing.slug, joined: true });
  }

  const { data: taken } = await admin.from("leagues").select("id").eq("slug", slug).maybeSingle();
  if (taken) return NextResponse.json({ error: "That web address is taken. Try another." }, { status: 409 });

  const { data: league, error } = await admin
    .from("leagues")
    .insert({
      slug, name, ea_league_id: body.eaLeagueId, console: conn.console,
      owner_id: user.id, ea_connection_id: conn.id, last_sync_status: "pending",
    })
    .select("id, slug")
    .single();
  if (error || !league) return NextResponse.json({ error: `Couldn't create the league: ${error?.message}` }, { status: 500 });

  await admin.from("league_members").insert({ league_id: league.id, user_id: user.id, role: "commissioner" });
  const started = await triggerSync(league.slug).catch(() => false);
  return NextResponse.json({ slug: league.slug, joined: false, syncStarted: started });
}
