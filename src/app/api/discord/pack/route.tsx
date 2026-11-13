// GET /api/discord/pack?l=<slug>&p=<id-id-id-id-id>&e=<expiry>&s=<signature>
// A pack's cards side by side as one PNG for the bot's /pack reply. Signed
// links only, like /api/discord/card.
import { ImageResponse } from "next/og";
import { checkCardLink } from "@/lib/discord/cardLink";
import { cardFonts, cardNode, preloadOvrArt, withLogo, xfGems } from "@/lib/discord/cardImage";
import { cardArtFor } from "@/lib/discord/cardArtLoad";
import { getLeagueData } from "@/lib/league/load";
import { leagueCardLayouts } from "@/lib/cardLayoutStore";
import { cardFramePath, signedCardArt } from "@/lib/cardArtStore";
import { cardFrameData, imageDataUrl } from "@/lib/discord/cardImage";
import { cardProps } from "@/lib/league/cardProps";

export const runtime = "nodejs";
export const maxDuration = 30;

const W = 300, GAP = 16, PAD = 20;

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const slug = q.get("l") || "", key = q.get("p") || "", exp = Number(q.get("e"));
  if (!/^\d+(-\d+){0,9}$/.test(key) || !checkCardLink(slug, key, exp, q.get("s") || "")) return new Response("Not found", { status: 404 });
  const d = await getLeagueData(slug);
  if (!d) return new Response("Not found", { status: 404 });
  const players = key.split("-").map((id) => d.players.find((p) => p.id === Number(id))).filter((p) => p !== undefined);
  if (!players.length) return new Response("Not found", { status: 404 });
  const [arts, layouts] = await Promise.all([Promise.all(players.map((p) => cardArtFor(slug, p))), leagueCardLayouts(slug)]);
  const n = players.length;
  await Promise.all([xfGems(), preloadOvrArt(players.map((p) => ({ ovr: p.ovr, pos: p.pos })))]);
  const frameOf = (id: number) => cardFrameData(layouts.get(id), async () => {
    const u = await signedCardArt(slug, id, 300, cardFramePath);
    return u ? (await imageDataUrl(u)) ?? undefined : undefined;
  });
  const props = await Promise.all(players.map(async (p) => withLogo({ ...cardProps(d, slug, p, d.teams.find((t) => t.id === p.team)), layout: layouts.get(p.id), frameArt: await frameOf(p.id) })));
  return new ImageResponse(
    (
      <div style={{ display: "flex", gap: GAP, padding: PAD, backgroundColor: "#070a14", width: n * W + (n - 1) * GAP + 2 * PAD, height: Math.round(W * 1.4) + 2 * PAD }}>
        {players.map((p, i) => (
          <div key={p.id} style={{ display: "flex" }}>
            {cardNode(props[i], arts[i].art, arts[i].cutout, W)}
          </div>
        ))}
      </div>
    ),
    {
      width: n * W + (n - 1) * GAP + 2 * PAD,
      height: Math.round(W * 1.4) + 2 * PAD,
      fonts: await cardFonts(),
      headers: { "cache-control": "public, max-age=3600, s-maxage=3600" },
    },
  );
}
