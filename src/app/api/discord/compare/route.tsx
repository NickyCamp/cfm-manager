// GET /api/discord/compare?l=<slug>&a=<player id>&b=<player id>&m=<stats|ratings>&w=<season|career|all>&y=<season key>&e=<expiry>&s=<signature>
// The /compare picture (compareImage.tsx). Signed links from the bot only.
import { checkCardLink } from "@/lib/discord/cardLink";
import { comparePlayers, type CompareBy, type CompareView } from "@/lib/discord/compare";
import { renderCompare } from "@/lib/discord/compareImage";
import { leagueBySlug } from "@/lib/discord/links";
import { getLeagueDataWithNicknames as getLeagueData } from "@/lib/nicknameStore";
import { leagueShort } from "@/lib/league/playerSeasons";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const slug = q.get("l") || "", a = Number(q.get("a")), b = Number(q.get("b")), exp = Number(q.get("e"));
  const by = (q.get("m") === "ratings" ? "ratings" : "stats") as CompareBy;
  const view = (["season", "career", "all"].includes(q.get("w") || "") ? q.get("w") : "season") as CompareView;
  const y = q.get("y") || "";
  if (!a || !b || !checkCardLink(slug, `cmp${a}-${b}-${by}-${view}-${y}`, exp, q.get("s") || "")) return new Response("Not found", { status: 404 });
  const d = await getLeagueData(slug);
  const pa = d?.players.find((x) => x.id === a), pb = d?.players.find((x) => x.id === b);
  if (!d || !pa || !pb) return new Response("Not found", { status: 404 });
  const lg = await leagueBySlug(slug).catch(() => null);
  const c = await comparePlayers(slug, d, leagueShort(lg?.name, slug), pa, pb, by, view, y || undefined);
  if (typeof c === "string") return new Response("Not found", { status: 404 });
  return renderCompare(slug, d, pa, pb, c);
}
