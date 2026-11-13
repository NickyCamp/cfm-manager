// PUT /api/leagues/<slug>/card-art/<playerId>/layout  { layout: { frame: true, ovr: false, ... } } (or { reset: true })
// Card builder: which built-in layers this card shows. Same rule as changing the art:
// the player's team owner (matched by EA name) or the league commissioner.
import { NextResponse } from "next/server";
import { cardArtAccess } from "@/lib/cardArtStore";
import { saveCardLayout } from "@/lib/cardLayoutStore";
import { normalizeLayout } from "@/lib/league/cardLayout";
import { getLeagueData } from "@/lib/league/load";

export const runtime = "nodejs";
type Ctx = { params: Promise<{ slug: string; playerId: string }> };

export async function PUT(req: Request, ctx: Ctx) {
  const { slug, playerId } = await ctx.params;
  const id = Number(playerId);
  if (!Number.isFinite(id) || id <= 0) return NextResponse.json({ error: "Bad player id." }, { status: 400 });
  const p = (await getLeagueData(slug).catch(() => null))?.players.find((x) => x.id === id);
  if (!p) return NextResponse.json({ error: "Player not found." }, { status: 404 });
  const access = await cardArtAccess(slug, p.gone ? undefined : p.team || undefined);
  if (!access.canEdit) return NextResponse.json({ error: access.why || "Sign in to change this card." }, { status: 403 });
  const body = (await req.json().catch(() => null)) as { layout?: unknown; reset?: boolean } | null;
  if (!body) return NextResponse.json({ error: "Nothing was sent." }, { status: 400 });
  try {
    await saveCardLayout(slug, id, body.reset ? null : normalizeLayout(body.layout));
  } catch (e) {
    console.error("save card layout", slug, id, e);
    return NextResponse.json({ error: "Couldn't save the card layout. Try again." }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
