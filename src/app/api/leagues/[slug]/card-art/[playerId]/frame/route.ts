// POST   /api/leagues/<slug>/card-art/<playerId>/frame  (multipart "file": a 750×1050 PNG border with a transparent middle)
// DELETE /api/leagues/<slug>/card-art/<playerId>/frame
// Card builder: a custom border uploaded for one card (Nick's request, 2026-11-13). Default borders are
// untouched; this only replaces the frame on this card. Same rule as the art: team owner or commissioner.
// Stored next to the art in the private card-art bucket; the card's layout gets customFrame on/off.
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { CARD_ART_BUCKET, cardArtAccess, cardFramePath, ensureCardArtBucket } from "@/lib/cardArtStore";
import { cardLayout, saveCardLayout } from "@/lib/cardLayoutStore";
import { DEFAULT_LAYOUT } from "@/lib/league/cardLayout";
import { getLeagueData } from "@/lib/league/load";

export const runtime = "nodejs";
const MAX_BYTES = 3 * 1024 * 1024;
type Ctx = { params: Promise<{ slug: string; playerId: string }> };

async function guard(ctx: Ctx) {
  const { slug, playerId } = await ctx.params;
  const id = Number(playerId);
  if (!Number.isFinite(id) || id <= 0) return { error: NextResponse.json({ error: "Bad player id." }, { status: 400 }) };
  const p = (await getLeagueData(slug).catch(() => null))?.players.find((x) => x.id === id);
  if (!p) return { error: NextResponse.json({ error: "Player not found." }, { status: 404 }) };
  const access = await cardArtAccess(slug, p.gone ? undefined : p.team || undefined);
  if (!access.canEdit) return { error: NextResponse.json({ error: access.why || "Sign in to change this card." }, { status: 403 }) };
  await ensureCardArtBucket();
  return { slug, id };
}

export async function POST(req: Request, ctx: Ctx) {
  const g = await guard(ctx);
  if ("error" in g) return g.error;
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No image was sent." }, { status: 400 });
  if (file.type !== "image/png") return NextResponse.json({ error: "Borders need to be a PNG (so the middle can be see-through)." }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "That image is too large (3 MB max)." }, { status: 413 });
  const { error } = await supabaseAdmin().storage.from(CARD_ART_BUCKET)
    .upload(cardFramePath(g.slug, g.id), await file.arrayBuffer(), { contentType: "image/png", upsert: true, cacheControl: "60" });
  if (error) return NextResponse.json({ error: "Couldn't save the border. Try again." }, { status: 502 });
  const inset = Number(form?.get("inset"));
  const cur = (await cardLayout(g.slug, g.id)) ?? DEFAULT_LAYOUT;
  await saveCardLayout(g.slug, g.id, { ...cur, customFrame: true, frame: true, frameInset: Number.isFinite(inset) ? inset : cur.frameInset });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const g = await guard(ctx);
  if ("error" in g) return g.error;
  await supabaseAdmin().storage.from(CARD_ART_BUCKET).remove([cardFramePath(g.slug, g.id)]);
  const cur = await cardLayout(g.slug, g.id);
  if (cur) await saveCardLayout(g.slug, g.id, { ...cur, customFrame: false });
  return NextResponse.json({ ok: true });
}
