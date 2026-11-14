import type { Metadata } from "next";
import Link from "next/link";
import { getLeagueData } from "@/lib/league/load";
import { marketBook, priceIndex } from "@/lib/league/markets";
import { auditTrades, closeLog, fmtET, ledgerRows, marketsForPage, type AuditRow, type CloseRow, type LedgerRow } from "@/lib/marketStore";
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
  const { book, shared, leagueId, bookKey, tickets } = await marketsForPage(slug, marketBook(d), d.season.year, priceIndex, d.season, d);
  const index = priceIndex(book);
  const PAGE = 200;
  let rows: AuditRow[] = [];
  let err = "";
  let closes: CloseRow[] = [];
  if (leagueId) closes = await closeLog(leagueId, d.season.year).catch(() => []);
  let ledger: LedgerRow[] = [];
  if (leagueId && tickets && !sp.market) ledger = await ledgerRows(leagueId, { user: sp.user, limit: 500 }).catch(() => []);
  const teamsById = new Map(d.teams.map((t) => [t.id, t]));
  const gameName = (id: number) => { const g = d.games.find((x) => x.id === id); return g ? `${teamsById.get(g.away)?.abbr ?? "?"} @ ${teamsById.get(g.home)?.abbr ?? "?"}` : `Game ${id}`; };
  if (leagueId) {
    try { rows = await auditTrades(leagueId, bookKey, { market: sp.market, user: sp.user, before: Number(sp.before) || undefined, limit: PAGE }); }
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
            <p className="muted">Every bet, cancel and settlement by every member in the {d.season.year} season, with the price before and after, plus every kickoff time set. Entries can&apos;t be edited or deleted, by anyone; a bet placed after a game&apos;s verified kickoff is marked void.</p>
          </div>
          {shared && <a className="btn" href={csv}>Download CSV</a>}
        </div>
        {!shared ? (
          <div className="panel"><p>Shared trading isn&apos;t switched on for this league yet, so there are no league trades to show.</p></div>
        ) : (
          <div className="panel mk-audit-panel">
            {filterText && <p className="small">Showing {filterText}. <Link href={`/l/${slug}/markets/activity`}>Show everything</Link></p>}
            {err ? <p className="mk-msg err">{err}</p> : rows.length ? <AuditTable slug={slug} rows={rows} index={index} currency={shared?.currency} /> : <p className="muted">No trades yet.</p>}
            {rows.length === PAGE && <p><Link href={keep({ before: String(rows[rows.length - 1].id) })}>Older trades →</Link></p>}
          </div>
        )}
        {tickets && !sp.market && (
          <div className="panel mk-audit-panel">
            <h3>Payouts</h3>
            <p className="muted small">The bot doesn&apos;t move Tickets. Every settled bet becomes a line here; after each advance the bot posts them in #previous-week-payouts for admins to add or remove in UnbelievaBoat and mark applied. Your balance on the site already counts them.</p>
            {ledger.length ? (
              <div className="tbl-wrap"><table className="tbl mk-audit">
                <thead><tr><th scope="col">#</th><th scope="col">When</th><th scope="col">Member</th><th className="num">Tickets</th><th scope="col">What</th><th scope="col">Status</th></tr></thead>
                <tbody>{ledger.map((x) => (
                  <tr key={x.id}>
                    <td className="muted">{x.id}</td><td className="nw">{fmtET(x.at)}</td><td>{x.user}</td>
                    <td className={`num ${x.amount > 0 ? "pos" : x.amount < 0 ? "neg" : ""}`}>{x.amount > 0 ? "+" : x.amount < 0 ? "−" : ""}{Math.round(Math.abs(x.amount)).toLocaleString("en-US")}</td>
                    <td>{x.kind === "result" ? `${x.side === "yes" ? "Yes" : "No"} · ${x.note}` : x.kind === "cashout" ? `Cashed out ${x.side === "yes" ? "Yes" : "No"} · ${index[x.market || ""]?.o[x.outcome || ""]?.[2] ?? x.outcome} (staked ${Math.round(x.cost || 0).toLocaleString("en-US")}, got ${Math.round(x.payout || 0).toLocaleString("en-US")})` : x.kind === "cancel" ? `Cancelled after the price fell (${index[x.market || ""]?.o[x.outcome || ""]?.[2] ?? x.outcome})` : x.kind === "void" ? `Voided: ${x.note}` : x.note}</td>
                    <td className="nw">{x.appliedAt ? <span title={x.appliedBy ?? ""}>Applied {fmtET(x.appliedAt)}</span> : x.reportKey ? "In the payouts report" : "Next report"}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            ) : <p className="muted">None yet.</p>}
          </div>
        )}
        {shared && !sp.market && !sp.user && (
          <div className="panel mk-audit-panel">
            <h3>Kickoff times set</h3>
            <p className="muted small">When betting closes on each game. Every change is kept, with who made it.</p>
            {closes.length ? (
              <div className="tbl-wrap"><table className="tbl mk-audit">
                <thead><tr><th scope="col">#</th><th scope="col">Set at</th><th scope="col">By</th><th scope="col">Game</th><th scope="col">Betting closes</th></tr></thead>
                <tbody>{closes.map((c) => <tr key={c.id}><td className="muted">{c.id}</td><td className="nw">{fmtET(c.at)}</td><td>{c.by} <span className="muted">({c.kind === "verified" ? "verified by an admin" : c.kind === "discord" ? "Discord" : "site"})</span></td><td><Link href={`/l/${slug}/markets/game-${c.gameId}`}>{gameName(c.gameId)}</Link></td><td className="nw">{fmtET(c.closeAt)}</td></tr>)}</tbody>
              </table></div>
            ) : <p className="muted">None yet.</p>}
          </div>
        )}
      </div>
    </main>
  );
}
