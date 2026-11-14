// GET /api/leagues/<slug>/markets/chart/<market key>[?w=<week>] — odds-over-time PNG for Discord.
// Public, like the market pages. Season-long markets only.
import { getLeagueData } from "@/lib/league/load";
import { marketBook } from "@/lib/league/markets";
import { marketsForDiscord, priceHistory } from "@/lib/marketStore";
import { bookKey } from "@/lib/tickets";
import { leagueBySlug } from "@/lib/discord/links";
import { renderOddsChart } from "@/lib/discord/oddsChartImage";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string; key: string }> }) {
  const { slug, key } = await params;
  const d = await getLeagueData(slug);
  if (!d) return new Response("Not found", { status: 404 });
  const raw = marketBook(d);
  const view = await marketsForDiscord(slug, raw, d.season.year, d.season);
  const book = view?.book ?? raw;
  const m = book.markets.find((x) => x.key === key);
  if (!m || m.gameId) return new Response("Not found", { status: 404 });
  const lg = await leagueBySlug(slug).catch(() => null);
  const points = view ? await priceHistory(view.leagueId, bookKey(d.season.year, view.tickets), key).catch(() => []) : [];
  return renderOddsChart(d, m, points, book.checkpoints, lg?.name || slug.toUpperCase());
}
