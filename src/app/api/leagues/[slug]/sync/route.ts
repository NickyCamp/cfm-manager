// POST /api/leagues/<slug>/sync — "Sync now" for league members.
import { NextResponse } from "next/server";
import { currentUser, supabaseAdmin } from "@/lib/supabase/server";
import { MANUAL_COOLDOWN_MS, requestSync } from "@/lib/sync";

export const runtime = "nodejs";

export async function POST(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const admin = supabaseAdmin();
  const { data: lg } = await admin.from("leagues").select("id, owner_id").eq("slug", slug).maybeSingle();
  if (!lg) return NextResponse.json({ error: "No such league." }, { status: 404 });
  const { data: member } = await admin.from("league_members").select("user_id").eq("league_id", lg.id).eq("user_id", user.id).maybeSingle();
  if (!member && lg.owner_id !== user.id) return NextResponse.json({ error: "Only league members can start a sync." }, { status: 403 });

  const r = await requestSync(slug, { minGapMs: MANUAL_COOLDOWN_MS, mode: "full", by: `manual:${user.id}` });
  if (r.started) return NextResponse.json({ ok: true, message: "Sync started. New data shows up in about 3 minutes." });
  if (r.reason === "recent") {
    const mins = Math.max(1, Math.ceil(((r.nextAt || Date.now()) - Date.now()) / 60_000));
    return NextResponse.json({ ok: false, message: `This league synced or was asked to sync recently. Try again in ${mins} min.` }, { status: 429 });
  }
  if (r.reason === "not-configured") return NextResponse.json({ ok: false, message: "On-demand syncing isn't set up yet; the league syncs on its schedule." }, { status: 503 });
  return NextResponse.json({ ok: false, message: "Couldn't start the sync. Try again in a few minutes." }, { status: 502 });
}
