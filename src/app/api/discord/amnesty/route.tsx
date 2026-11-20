// GET /api/discord/amnesty?l=<slug>&p=<player id>&e=<expiry>&s=<signature>
// The /amnesty chart picture. Signed links from the bot only.
import { checkCardLink } from "@/lib/discord/cardLink";
import { renderAmnesty } from "@/lib/discord/amnestyImage";
import { getLeagueData } from "@/lib/league/load";
import { leagueBySlug } from "@/lib/discord/links";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const slug = q.get("l") || "", id = Number(q.get("p")), exp = Number(q.get("e"));
  if (!id || !checkCardLink(slug, `a${id}`, exp, q.get("s") || "")) return new Response("Not found", { status: 404 });
  const d = await getLeagueData(slug);
  const p = d?.players.find((x) => x.id === id);
  if (!d || !p) return new Response("Not found", { status: 404 });
  const lg = await leagueBySlug(slug).catch(() => null);
  return renderAmnesty(d, p, lg?.name || slug.toUpperCase());
}
