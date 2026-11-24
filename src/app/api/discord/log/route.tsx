// GET /api/discord/log?l=<slug>&p=<player id>&y=<season key ("2027", "nfl-2025") or "career">&e=<expiry>&s=<signature>
// The /gamelog and /yearlog pictures (logImage.tsx). Signed links from the bot only.
import { checkCardLink } from "@/lib/discord/cardLink";
import { renderGameLog, renderYearLog } from "@/lib/discord/logImage";
import { getLeagueData } from "@/lib/league/load";
import { leagueBySlug } from "@/lib/discord/links";
import { leagueShort, playerSeasons, seasonKey } from "@/lib/league/playerSeasons";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const slug = q.get("l") || "", pid = Number(q.get("p")), y = q.get("y") || "", exp = Number(q.get("e"));
  if (!pid || !y || !checkCardLink(slug, `log${pid}-${y}`, exp, q.get("s") || "")) return new Response("Not found", { status: 404 });
  const d = await getLeagueData(slug);
  const p = d?.players.find((x) => x.id === pid);
  if (!d || !p) return new Response("Not found", { status: 404 });
  const lg = await leagueBySlug(slug).catch(() => null);
  const league = leagueShort(lg?.name, slug);
  const seasons = await playerSeasons(slug, d, p);
  if (y === "career") return renderYearLog(d, p, seasons, league);
  const s = seasons.find((x) => seasonKey(x) === y);
  if (!s) return new Response("Not found", { status: 404 });
  return renderGameLog(d, p, s, league);
}
