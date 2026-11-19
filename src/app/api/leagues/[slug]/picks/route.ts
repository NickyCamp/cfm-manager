// POST /api/leagues/<slug>/picks: a commissioner records a draft pick changing hands, or undoes a recorded move.
//   { action: "add", y, r, o, to, note? }  (from = whoever holds the pick now, per the tracker)
//   { action: "remove", id }
// Kept in leagues.settings.pickMoves; the standing is rebuilt from them (lib/league/picks.ts). Nick, 2026-11-18.
import { NextResponse } from "next/server";
import { currentUser, supabaseAdmin } from "@/lib/supabase/server";
import { isCommissioner } from "@/lib/marketStore";
import { updateLeagueSettings } from "@/lib/leagueSettings";
import { getLeagueData, getLeagueHistory } from "@/lib/league/load";
import { buildPickLedger, pickId, type PickMove } from "@/lib/league/picks";
import type { TradePicks } from "@/lib/league/history";

export const runtime = "nodejs";
type Ctx = { params: Promise<{ slug: string }> };
const MAX_MOVES = 500;

export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const user = await currentUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { data: lg } = await supabaseAdmin().from("leagues").select("id, settings").eq("slug", slug).maybeSingle();
  if (!lg) return NextResponse.json({ error: "League not found." }, { status: 404 });
  if (!(await isCommissioner(lg.id, user.id).catch(() => false))) return NextResponse.json({ error: "Only a commissioner can record pick moves." }, { status: 403 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;

  if (body?.action === "remove") {
    const id = String(body.id || "");
    const r = await updateLeagueSettings(lg.id, (s) => {
      const list = (s.pickMoves as PickMove[] | undefined) || [];
      if (!list.some((m) => m.id === id)) return null;
      s.pickMoves = list.filter((m) => m.id !== id);
      return s;
    });
    if (!r.ok) return NextResponse.json({ error: r.error || "Couldn't save." }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (body?.action !== "add") return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  const [d, hist] = await Promise.all([getLeagueData(slug), getLeagueHistory(slug).catch(() => null)]);
  if (!d) return NextResponse.json({ error: "No league data yet." }, { status: 404 });
  const y = Number(body.y), r = Number(body.r), o = Number(body.o), to = Number(body.to);
  const ids = new Set(d.teams.map((t) => t.id));
  if (!Number.isInteger(r) || r < 1 || r > 7 || !ids.has(o) || !ids.has(to)) return NextResponse.json({ error: "Pick a year, round, whose pick it is and the team getting it." }, { status: 400 });
  const settings = (lg.settings || {}) as Record<string, unknown>;
  const l = buildPickLedger({ d, events: hist?.events || [], tradePicks: (settings.tradePicks as TradePicks | undefined) || {}, moves: (settings.pickMoves as PickMove[] | undefined) || [] });
  if (!l.years.includes(y)) return NextResponse.json({ error: `Only the ${l.years.join(", ")} drafts can be changed.` }, { status: 400 });
  const from = l.picks.get(pickId(y, r, o))?.owner ?? o;
  if (from === to) return NextResponse.json({ error: "That team already has this pick." }, { status: 400 });

  const meta = user.user_metadata as { name?: string; full_name?: string } | undefined;
  const move: PickMove = {
    id: `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, at: new Date().toISOString(),
    y, r, o, from, to, src: "manual",
    note: typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 80) : undefined,
    by: meta?.name || meta?.full_name || user.email?.split("@")[0] || undefined,
  };
  const res = await updateLeagueSettings(lg.id, (s) => {
    const list = (s.pickMoves as PickMove[] | undefined) || [];
    if (list.length >= MAX_MOVES) return null;
    s.pickMoves = [...list, move];
    return s;
  });
  if (!res.ok) return NextResponse.json({ error: res.error || "Couldn't save." }, { status: 500 });
  if (!res.changed) return NextResponse.json({ error: "Too many recorded moves; undo some old ones first." }, { status: 400 });
  return NextResponse.json({ ok: true, move });
}
