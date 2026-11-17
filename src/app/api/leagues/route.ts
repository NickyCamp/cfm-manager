// POST /api/leagues  { connectionId, eaLeagueId, name, slug }
// Adds a league the user picked after connecting EA. If someone already added
// the same league, the user joins it instead of creating a duplicate.

import { NextResponse } from "next/server";
import { currentUser, supabaseAdmin } from "@/lib/supabase/server";
import { RESERVED_SLUGS, SLUG_RE } from "@/lib/slug";
import { triggerSync } from "@/lib/dispatch";
import { decryptJson, encryptJson } from "@/lib/crypto";
import { EaError, listLeagues, refreshToken, type EaToken } from "@/lib/ea/client";

export const runtime = "nodejs";
export const maxDuration = 60; // one sign-in to the Madden servers to confirm the league

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
    .select("id, user_id, console, token_ciphertext")
    .eq("id", body.connectionId)
    .single();
  if (!conn || conn.user_id !== user.id) return NextResponse.json({ error: "That EA connection isn't yours. Connect EA again." }, { status: 403 });

  // The league has to be one this EA profile is really in. The league id comes from the browser, and
  // without this check any signed-in account could send another league's id and be added to it as a
  // member (members can bet in its Markets, start syncs and link it to a Discord server), or take over
  // an orphaned one as its owner.
  const eaLeagueId = Number(body.eaLeagueId);
  try {
    const stored = decryptJson<EaToken>(conn.token_ciphertext as string);
    const tok = await refreshToken(stored);
    if (tok.accessToken !== stored.accessToken) {
      await admin.from("ea_connections").update({ token_ciphertext: encryptJson(tok), updated_at: new Date().toISOString() }).eq("id", conn.id);
    }
    const mine = await listLeagues(tok);
    if (!mine.some((l) => l.leagueId === eaLeagueId)) {
      return NextResponse.json({ error: "EA doesn't list that league for this EA profile. Connect EA again and pick it from the list." }, { status: 403 });
    }
  } catch (e) {
    console.error("add league: EA check failed", e instanceof EaError ? e.detail : e);
    return NextResponse.json({ error: "Couldn't check with EA that you're in that league. Connect EA again, or try in a minute." }, { status: 502 });
  }

  // Already on CFM Manager? Join it. Matched on the EA league id alone, whatever the
  // console: cross-play leagues have one id on every platform, and keying on the
  // console too gave PC players their own copy of a PS5 league (2026-11-13).
  const { data: existing } = await admin
    .from("leagues")
    .select("id, slug, owner_id, settings")
    .eq("ea_league_id", eaLeagueId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (existing) {
    // Everyone had removed it (30-day delete clock running): whoever adds it back owns it, syncs it with
    // their EA connection, and the clock stops.
    const settings = { ...((existing.settings as Record<string, unknown>) || {}) };
    const orphaned = Boolean(settings.orphanedAt);
    if (orphaned) {
      delete settings.orphanedAt;
      await admin.from("leagues").update({ settings, owner_id: user.id, ea_connection_id: conn.id }).eq("id", existing.id);
    }
    const owner = orphaned || existing.owner_id === user.id;
    await admin.from("league_members").upsert({ league_id: existing.id, user_id: user.id, role: owner ? "commissioner" : "member" }, { onConflict: "league_id,user_id", ignoreDuplicates: true });
    if (orphaned) await triggerSync(existing.slug).catch(() => false);
    return NextResponse.json({ slug: existing.slug, joined: true });
  }

  const { data: taken } = await admin.from("leagues").select("id").eq("slug", slug).maybeSingle();
  if (taken) return NextResponse.json({ error: "That web address is taken. Try another." }, { status: 409 });

  const { data: league, error } = await admin
    .from("leagues")
    .insert({
      slug, name, ea_league_id: eaLeagueId, console: conn.console,
      owner_id: user.id, ea_connection_id: conn.id, last_sync_status: "pending",
    })
    .select("id, slug")
    .single();
  if (error || !league) return NextResponse.json({ error: `Couldn't create the league: ${error?.message}` }, { status: 500 });

  await admin.from("league_members").insert({ league_id: league.id, user_id: user.id, role: "commissioner" });
  const started = await triggerSync(league.slug).catch(() => false);
  return NextResponse.json({ slug: league.slug, joined: false, syncStarted: started });
}
