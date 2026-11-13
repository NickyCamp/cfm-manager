import { getLeagueData } from "@/lib/league/load";
import { marketBook, priceIndex } from "@/lib/league/markets";
import { auditTrades, marketsForPage } from "@/lib/marketStore";

// The whole public trade log as CSV (optionally ?market= / ?user=), for anyone auditing.
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const url = new URL(req.url);
  const d = await getLeagueData(slug);
  if (!d) return new Response("No league data", { status: 404 });
  const { book, leagueId } = await marketsForPage(slug, marketBook(d), d.season.year, priceIndex);
  if (!leagueId) return new Response("Shared trading isn't set up", { status: 404 });
  const index = priceIndex(book);
  const all = [];
  let before: number | undefined;
  for (let i = 0; i < 100; i++) {
    const rows = await auditTrades(leagueId, d.season.year, { market: url.searchParams.get("market") || undefined, user: url.searchParams.get("user") || undefined, before, limit: 1000 });
    all.push(...rows);
    if (rows.length < 1000) break;
    before = rows[rows.length - 1].id;
  }
  const esc = (v: unknown) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = [["id", "time_utc", "member", "kind", "side", "market_key", "market", "outcome_id", "outcome", "contracts", "amount_usd", "yes_price_before", "yes_price_after"].join(",")];
  for (const r of all) lines.push([r.id, r.at, r.user, r.kind, r.side, r.market, index[r.market]?.t ?? "", r.outcome, index[r.market]?.o[r.outcome]?.[2] ?? "", r.qty, r.amount.toFixed(2), r.before ?? "", r.after ?? ""].map(esc).join(","));
  return new Response(lines.join("\n") + "\n", {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${slug}-${d.season.year}-market-trades.csv"`, "cache-control": "no-store" },
  });
}
