// GET /api/discord/card?l=<slug>&p=<player id>&e=<expiry>&s=<signature>[&side=both]
// The player's trading card as a PNG for the bot's /player reply. Only signed
// links from the bot work, since the card can show members-only uploaded art.
import { checkCardLink } from "@/lib/discord/cardLink";
import { renderCard } from "@/lib/discord/cardImage";
import { cardArtFor } from "@/lib/discord/cardArtLoad";
import { getLeagueData } from "@/lib/league/load";
import { leagueCardLayouts } from "@/lib/cardLayoutStore";
import { cardFramePath, signedCardArt } from "@/lib/cardArtStore";
import { cardFrameData, imageDataUrl } from "@/lib/discord/cardImage";
import { cardBackProps, cardProps } from "@/lib/league/cardProps";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const slug = q.get("l") || "", id = Number(q.get("p")), exp = Number(q.get("e"));
  if (!checkCardLink(slug, id, exp, q.get("s") || "")) return new Response("Not found", { status: 404 });
  const d = await getLeagueData(slug);
  const p = d?.players.find((x) => x.id === id);
  if (!d || !p) return new Response("Not found", { status: 404 });
  const [{ art, cutout }, layouts] = await Promise.all([cardArtFor(slug, p), leagueCardLayouts(slug)]);
  const both = q.get("side") === "both";
  const layout = layouts.get(p.id);
  const frameArt = await cardFrameData(layout, async () => {
    const u = await signedCardArt(slug, p.id, 300, cardFramePath);
    return u ? (await imageDataUrl(u)) ?? undefined : undefined;
  });
  const props = { ...cardProps(d, slug, p, d.teams.find((t) => t.id === p.team)), ...(both ? cardBackProps(d, p) : {}), layout, frameArt };
  return renderCard(props, art, cutout, both ? "both" : "front");
}
