// GET /api/discord/stats?l=<slug>&c=<category>[&t=<team id>]&e=<expiry>&s=<signature>
// The /stats chart picture. Signed links from the bot only.
import { checkCardLink } from "@/lib/discord/cardLink";
import { renderStats } from "@/lib/discord/statsImage";
import { STAT_CATS } from "@/lib/discord/stats";
import { getLeagueData } from "@/lib/league/load";
import { leagueBySlug } from "@/lib/discord/links";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const slug = q.get("l") || "", c = q.get("c") || "", tq = q.get("t"), exp = Number(q.get("e"));
  const teamId = tq ? Number(tq) : undefined;
  const cat = STAT_CATS.find((x) => x.key === c);
  if (!cat || !checkCardLink(slug, `s${c}-${teamId ?? ""}`, exp, q.get("s") || "")) return new Response("Not found", { status: 404 });
  const d = await getLeagueData(slug);
  if (!d) return new Response("Not found", { status: 404 });
  const team = teamId != null ? d.teams.find((t) => t.id === teamId) : undefined;
  const lg = await leagueBySlug(slug).catch(() => null);
  return renderStats(d, cat, team, lg?.name || slug.toUpperCase());
}
