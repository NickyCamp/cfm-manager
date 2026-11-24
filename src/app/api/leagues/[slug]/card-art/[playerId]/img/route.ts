// GET /api/leagues/<slug>/card-art/<playerId>/img?e=<expiry>&s=<signature>[&f=1]
// A player's uploaded card art (or, with f=1, custom border) for the site. Links come from
// cardArtLink(), signed and the same all day, so browsers keep the image. The file is kept in
// memory and only re-checked with Supabase about once a minute (storageCache.ts).
import { cardArtFile, cardArtPath, cardFramePath, checkCardArtLink } from "@/lib/cardArtStore";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ slug: string; playerId: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { slug, playerId } = await ctx.params;
  const id = Number(playerId);
  const q = new URL(req.url).searchParams;
  const frame = q.get("f") === "1";
  if (!checkCardArtLink(slug, id, frame, Number(q.get("e")), q.get("s") || "")) return new Response("Not found", { status: 404 });
  const f = await cardArtFile(slug, id, frame ? cardFramePath : cardArtPath);
  if (!f) return new Response("Not found", { status: 404, headers: { "cache-control": "private, max-age=60" } });
  const headers: Record<string, string> = {
    "content-type": f.type || "image/jpeg",
    // Private: members-only art, never kept by a shared cache. A minute, then the browser asks again
    // (and gets a 304 with no image if it hasn't changed).
    "cache-control": "private, max-age=60",
  };
  if (f.lastModified) headers["last-modified"] = f.lastModified;
  const since = req.headers.get("if-modified-since");
  if (since && f.lastModified && since === f.lastModified) return new Response(null, { status: 304, headers });
  return new Response(new Uint8Array(f.buf), { headers });
}
