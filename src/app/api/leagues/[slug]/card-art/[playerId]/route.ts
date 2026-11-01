// POST   /api/leagues/<slug>/card-art/<playerId>  (multipart "file", a JPEG the editor already cropped)
// DELETE /api/leagues/<slug>/card-art/<playerId>
// League members only. Images go to the private card-art bucket.
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { CARD_ART_BUCKET, cardArtPath, ensureCardArtBucket, leagueMemberId } from "@/lib/cardArtStore";

export const runtime = "nodejs";
const MAX_BYTES = 3 * 1024 * 1024;

type Ctx = { params: Promise<{ slug: string; playerId: string }> };

async function guard(ctx: Ctx) {
  const { slug, playerId } = await ctx.params;
  const id = Number(playerId);
  if (!Number.isFinite(id) || id <= 0) return { error: NextResponse.json({ error: "Bad player id." }, { status: 400 }) };
  const uid = await leagueMemberId(slug);
  if (!uid) return { error: NextResponse.json({ error: "Only league members can change card art." }, { status: 403 }) };
  await ensureCardArtBucket();
  return { slug, id };
}

export async function POST(req: Request, ctx: Ctx) {
  const g = await guard(ctx);
  if ("error" in g) return g.error;
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No image was sent." }, { status: 400 });
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return NextResponse.json({ error: "Use a JPEG, PNG or WebP image." }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "That image is too large (3 MB max)." }, { status: 413 });
  const { error } = await supabaseAdmin().storage.from(CARD_ART_BUCKET)
    .upload(cardArtPath(g.slug, g.id), await file.arrayBuffer(), { contentType: "image/jpeg", upsert: true, cacheControl: "60" });
  if (error) return NextResponse.json({ error: "Couldn't save the image. Try again." }, { status: 502 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const g = await guard(ctx);
  if ("error" in g) return g.error;
  await supabaseAdmin().storage.from(CARD_ART_BUCKET).remove([cardArtPath(g.slug, g.id)]);
  return NextResponse.json({ ok: true });
}
