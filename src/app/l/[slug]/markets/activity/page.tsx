import type { Metadata } from "next";
import Link from "next/link";
import { getLeagueData } from "@/lib/league/load";
import { marketBook, priceIndex } from "@/lib/league/markets";
import { auditTrades, closeLog, fmtET, marketsForPage, type AuditRow, type CloseRow } from "@/lib/marketStore";
import { NoData } from "@/components/league/bits";
import { AuditTable } from "@/components/league/markets/AuditTable";

export const metadata: Metadata = { title: "Trade log · Markets" };
type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | undefined>> };

// Public audit log (Nick, 2026-11-13): every market trade by every member, newest first.
// The table behind it is append-only (supabase/migrations/0003_markets.sql).
export default async function MarketActivity({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;
  const d = await getLeagueData(slug);
  if (!d) return <NoData />;
  const { book, shared, leagueId } = await marketsForPage(slug, marketBook(d), d.season.year, priceIndex, d.season);
  const index = priceIndex(book);
  const PAGE = 200;
  let rows: AuditRow[] = [];
  let err = "";
  let closes: CloseRow[] = [];
  if (leagueId) closes = await closeLog(leagueId, d.season.year).catch(() => []);
  const teamsById = new Map(d.teams.map((t) => [t.id, t]));
  const gameName = (id: number) => { const g = d.games.find((x) => x.id === id); return g ? `${teamsById.get(g.away)?.abbr ?? "?"} @ ${teamsById.get(g.home)?.abbr ?? "?"}` : `Game ${id}`; };
  if (leagueId) {
    try { rows = await auditTrades(leagueId, d.season.year, { market: sp.market, user: sp.user, before: Number(sp.before) || undefined, limit: PAGE }); }
    catch (e) { err = e instanceof Error ? e.message : "Couldn't load the log."; }
  }
  const filterText = [sp.market && `market: ${index[sp.market]?.t ?? sp.market}`, sp.user && `member: ${rows[0]?.user ?? "selected"}`].filter(Boolean).join(", ");
  const csv = `/api/leagues/${slug}/markets/trades${sp.market || sp.user ? `?${new URLSearchParams(Object.fromEntries(Object.entries({ market: sp.market, user: sp.user }).filter(([, v]) => v)) as Record<string, string>)}` : ""}`;
  const keep = (extra: Record<string, string>) => `?${new URLSearchParams({ ...(sp.market ? { market: sp.market } : {}), ...(sp.user ? { user: sp.user } : {}), ...extra })}`;

  return (
    <main className="page league-page markets-page">
      <div className="wrap wide">
        <nav className="mk-crumbs" aria-label="Breadcrumb"><Link href={`/l/${slug}/markets`}>Markets</Link><span aria-hidden> / </span>Trade log</nav>
        <div className="mk-detail-head">
          <div>
            <h2>Public trade log</h2>
            <p className="muted">Every buy, sell and payout by every member in the {d.season.year} season, with the price before and after, plus every kickoff time set. Entries can&apos;t be edited or deleted, by anyone.</p>
          </div>
          {shared && <a className="btn" href={csv}>Download CSV</a>}
        </div>
        {!shared ? (
          <div className="panel"><p>Shared trading isn&apos;t switched on for this league yet, so there are no league trades to show.</p></div>
        ) : (
          <div className="panel mk-audit-panel">
            {filterText && <p className="small">Showing {filterText}. <Link href={`/l/${slug}/markets/activity`}>Show everything</Link></p>}
            {err ? <p className="mk-msg err">{err}</p> : rows.length ? <AuditTable slug={slug} rows={rows} index={index} /> : <p className="muted">No trades yet.</p>}
            {rows.length === PAGE && <p><Link href={keep({ before: String(rows[rows.length - 1].id) })}>Older trades →</Link></p>}
          </div>
        )}
        {shared && !sp.market && !sp.user && (
          <div className="panel mk-audit-panel">
            <h3>Kickoff times set</h3>
            <p className="muted small">When betting closes on each game. Every change is kept, with who made it.</p>
            {closes.length ? (
              <div className="tbl-wrap"><table className="tbl mk-audit">
                <thead><tr><th scope="col">#</th><th scope="col">Set at</th><th scope="col">By</th><th scope="col">Game</th><th scope="col">Betting closes</th></tr></thead>
                <tbody>{closes.map((c) => <tr key={c.id}><td className="muted">{c.id}</td><td className="nw">{fmtET(c.at)}</td><td>{c.by} <span className="muted">({c.kind === "discord" ? "Discord" : "site"})</span></td><td><Link href={`/l/${slug}/markets/game-${c.gameId}`}>{gameName(c.gameId)}</Link></td><td className="nw">{fmtET(c.closeAt)}</td></tr>)}</tbody>
              </table></div>
            ) : <p className="muted">None yet.</p>}
          </div>
        )}
      </div>
    </main>
  );
}
