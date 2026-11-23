// RedZone host (Nick, 2026-11-22). The Live tab's big player follows whatever a league admin picks while hosting;
// with no host for 10 minutes it auto-rotates through live streams.
// GET  → { teamId, by, at, active }   (polled every few seconds by everyone on the Live tab)
// POST { teamId: number | null }      (admins only; null stops hosting)
// Stored in leagues.settings.redzone = { teamId, by, at }.
import { NextResponse } from "next/server";
import { currentUser, supabaseAdmin } from "@/lib/supabase/server";
import { editableStreamTeams, leagueSettingsBySlug } from "@/lib/streamStore";
import { updateLeagueSettings } from "@/lib/leagueSettings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ slug: string }> };
export type RedzoneState = { teamId: number | null; by: string; at: string };
const HOST_IDLE_MS = 10 * 60_000;

const cache = new Map<string, { at: number; state: RedzoneState | null }>();

function view(s: RedzoneState | null) {
  const active = Boolean(s?.teamId && Date.now() - Date.parse(s.at) < HOST_IDLE_MS);
  return { teamId: active ? s!.teamId : null, by: active ? s!.by : "", at: s?.at ?? null, active };
}

export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const hit = cache.get(slug);
  if (hit && Date.now() - hit.at < 2500) return NextResponse.json(view(hit.state), { headers: { "cache-control": "no-store" } });
  const row = await leagueSettingsBySlug(slug).catch(() => null);
  const state = ((row?.settings?.redzone as RedzoneState | undefined) ?? null);
  cache.set(slug, { at: Date.now(), state });
  return NextResponse.json(view(state), { headers: { "cache-control": "no-store" } });
}

export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const { admin } = await editableStreamTeams(slug);
  if (!admin) return NextResponse.json({ error: "Only league admins can host the RedZone." }, { status: 403 });
  const body = (await req.json().catch(() => null)) as { teamId?: unknown } | null;
  const teamId = body?.teamId == null ? null : Number(body.teamId);
  if (teamId !== null && (!Number.isInteger(teamId) || teamId <= 0)) return NextResponse.json({ error: "Bad team." }, { status: 400 });
  const row = await leagueSettingsBySlug(slug);
  if (!row) return NextResponse.json({ error: "League not found." }, { status: 404 });
  const user = await currentUser().catch(() => null);
  const { data: prof } = user ? await supabaseAdmin().from("profiles").select("display_name").eq("id", user.id).maybeSingle() : { data: null };
  const state: RedzoneState = { teamId, by: (prof?.display_name as string) || user?.email?.split("@")[0] || "Admin", at: new Date().toISOString() };
  const res = await updateLeagueSettings(row.id, (s) => ({ ...s, redzone: state }));
  if (!res.ok) return NextResponse.json({ error: res.error || "Couldn't save." }, { status: 502 });
  cache.set(slug, { at: Date.now(), state });
  return NextResponse.json(view(state));
}
