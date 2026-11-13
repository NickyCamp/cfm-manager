// GET /api/discord/card?l=<slug>&p=<player id>&e=<expiry>&s=<signature>
// The player's trading card as a PNG for the bot's /player reply. Only signed
// links from the bot work, since the card can show members-only uploaded art.
import { checkCardLink } from "@/lib/discord/cardLink";
import { imageDataUrl, renderCard } from "@/lib/discord/cardImage";
import { getLeagueData } from "@/lib/league/load";
import { cardProps } from "@/lib/league/cardProps";
import { headshotUrl } from "@/lib/league/headshots";
import { signedCardArt } from "@/lib/cardArtStore";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const slug = q.get("l") || "", id = Number(q.get("p")), exp = Number(q.get("e"));
  if (!checkCardLink(slug, id, exp, q.get("s") || "")) return new Response("Not found", { status: 404 });
  const d = await getLeagueData(slug);
  const p = d?.players.find((x) => x.id === id);
  if (!d || !p) return new Response("Not found", { status: 404 });

  // Same order as the site: uploaded art → NFL.com headshot (as a cut-out) → jersey number.
  let art: string | null = null, cutout = false;
  const uploaded = await signedCardArt(slug, id, 300);
  if (uploaded) art = await imageDataUrl(uploaded);
  if (!art) {
    const hs = headshotUrl(p);
    if (hs) { art = await imageDataUrl(hs.replace("f_auto", "f_png")); cutout = Boolean(art); }
  }
  const team = d.teams.find((t) => t.id === p.team);
  return renderCard(cardProps(d, slug, p, team), art || undefined, cutout);
}
