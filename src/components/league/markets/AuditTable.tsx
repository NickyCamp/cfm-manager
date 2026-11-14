// The public trade log table (server component).
import Link from "next/link";
import type { PriceIndex } from "@/lib/league/marketTypes";
import type { AuditRow } from "@/lib/marketStore";

const fmtTime = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " ET";
const usd = (x: number) => `$${x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const cents = (p: number | null) => (p == null ? "" : `${Math.round(p * 100)}¢`);

export function AuditTable({ slug, rows, index, showMarket = true, currency = "usd" }: { slug: string; rows: AuditRow[]; index: PriceIndex; showMarket?: boolean; currency?: "usd" | "tickets" }) {
  const amt = (x: number) => (currency === "tickets" ? `${Math.round(x).toLocaleString("en-US")} Tickets` : usd(x));
  return (
    <div className="tbl-wrap">
      <table className="tbl mk-audit">
        <thead>
          <tr>
            <th scope="col">#</th><th scope="col">When</th><th scope="col">Member</th><th scope="col">Action</th>
            {showMarket && <th scope="col">Market</th>}<th scope="col">Outcome</th>
            <th className="num">Contracts</th><th className="num">{currency === "tickets" ? "Tickets" : "Amount"}</th><th className="num">Yes price before → after</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const mk = index[r.market];
            const label = mk?.o[r.outcome]?.[2] ?? r.outcome;
            const action = r.kind === "settle" ? (r.amount > 0 ? "Paid out" : "Expired") : `${r.kind === "buy" ? "Bought" : "Cancelled"} ${r.side === "yes" ? "Yes" : "No"}`;
            return (
              <tr key={r.id}>
                <td className="muted">{r.id}</td>
                <td className="nw">{fmtTime(r.at)}</td>
                <td className="nw"><Link href={`/l/${slug}/markets/activity?user=${r.userId}`}>{r.user}</Link></td>
                <td className="nw"><span className={`mk-side ${r.side}`}>{action}</span></td>
                {showMarket && <td><Link href={`/l/${slug}/markets/${r.market}`}>{mk?.t ?? r.market}</Link></td>}
                <td>{label}{r.kind === "settle" ? <span className="muted"> ({r.side === "yes" ? "Yes" : "No"})</span> : null}</td>
                <td className="num">{r.qty}</td>
                <td className={`num ${r.kind === "buy" ? "" : r.amount > 0 ? "pos" : ""}`}>{r.kind === "buy" ? "−" : "+"}{amt(r.amount)}</td>
                <td className="num muted">{r.before != null ? `${cents(r.before)} → ${cents(r.after)}` : ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
