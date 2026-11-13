// GET /api/discord/matchup?l=<slug>&g=<game id>&e=<expiry>&s=<signature>
// The /tws picture: the matchup chart for an unplayed game, or the scoreboard,
// team stat bars and leaders for a finished one. Signed links from the bot only.
import { checkCardLink } from "@/lib/discord/cardLink";
import { renderMatchup } from "@/lib/discord/matchupImage";
import { getLeagueData } from "@/lib/league/load";
import { leagueBySlug } from "@/lib/discord/links";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const slug = q.get("l") || "", id = Number(q.get("g")), exp = Number(q.get("e"));
  if (!id || !checkCardLink(slug, `g${id}`, exp, q.get("s") || "")) return new Response("Not found", { status: 404 });
  const d = await getLeagueData(slug);
  const g = d?.games.find((x) => x.id === id);
  const away = d?.teams.find((t) => t.id === g?.away), home = d?.teams.find((t) => t.id === g?.home);
  if (!d || !g || !away || !home) return new Response("Not found", { status: 404 });
  const lg = await leagueBySlug(slug).catch(() => null);
  return renderMatchup(d, g, away, home, lg?.name || slug.toUpperCase());
}
