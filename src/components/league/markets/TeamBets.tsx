// A team's bets (team page → Markets tab): open bets on top, finished ones below. Server component.
import Link from "next/link";
import type { Market } from "@/lib/league/marketTypes";
import type { TeamBet } from "@/lib/marketStore";

const day = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function TeamBets({ slug, open, done, markets, tickets, members }: { slug: string; open: TeamBet[]; done: TeamBet[]; markets: Market[]; tickets: boolean; members: string[] }) {
  const unit = tickets ? 100 : 1;
  const amt = (x: number) => (tickets ? `${Math.round(x).toLocaleString("en-US")}` : `$${x.toFixed(2)}`);
  const byKey = new Map(markets.map((m) => [m.key, m]));
  const info = (b: TeamBet) => {
    const m = byKey.get(b.market);
    const o = m?.outcomes.find((x) => x.id === b.outcome);
    return { m, o, title: m?.title ?? b.market, label: o?.label ?? b.outcome };
  };
  const BetCell = ({ b }: { b: TeamBet }) => {
    const { m, title, label } = info(b);
    return (
      <td>
        <span className={`mk-side ${b.side}`}>{b.side === "yes" ? "Yes" : "No"}</span> {label}
        <div className="muted small">{m ? <Link href={`/l/${slug}/markets/${m.key}`}>{title}</Link> : title}</div>
      </td>
    );
  };
  const staked = open.reduce((a, b) => a + b.cost, 0);
  const toWin = open.reduce((a, b) => a + b.qty * unit, 0);
  const settled = done.filter((b) => b.result !== "cancelled");
  const profit = settled.reduce((a, b) => a + (b.payout || 0) - b.cost, 0);
  const wins = settled.filter((b) => b.result === "won").length;
  const cur = tickets ? " Tickets" : "";

  return (
    <div className="team-bets">
      <div className="mk-port-stats">
        <div><span>Open bets</span><strong>{open.length}</strong></div>
        <div><span>Staked{cur ? " (Tickets)" : ""}</span><strong>{amt(staked)}</strong></div>
        <div><span>Settled record</span><strong>{wins}–{settled.length - wins}</strong></div>
        <div><span>Settled profit{cur ? " (Tickets)" : ""}</span><strong className={profit > 0.004 ? "pos" : profit < -0.004 ? "neg" : ""}>{profit >= 0 ? "+" : ""}{amt(profit)}</strong></div>
      </div>
      {members.length > 1 && <p className="muted small">Bets by {members.join(" and ")}.</p>}

      <section className="panel">
        <div className="section-head"><h3>Active bets</h3><span className="muted small">Can be cancelled for what they cost until they lock</span></div>
        {open.length ? (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Bet</th><th className="num">Contracts</th><th className="num">Cost{cur}</th><th className="num">Avg</th><th className="num">Now</th><th className="num">Pays if right</th><th>Locks</th><th>Placed</th></tr></thead>
              <tbody>
                {open.map((b) => {
                  const { m, o } = info(b);
                  const yes = o ? (o.state === "won" ? 1 : o.state === "lost" ? 0 : o.p) : null;
                  const now = yes == null ? null : b.side === "yes" ? yes : 1 - yes;
                  return (
                    <tr key={`${b.market}|${b.outcome}|${b.side}|${b.user}`}>
                      <BetCell b={b} />
                      <td className="num">{Math.round(b.qty).toLocaleString("en-US")}</td>
                      <td className="num">{amt(b.cost)}</td>
                      <td className="num">{Math.round((b.cost / b.qty / unit) * 100)}¢</td>
                      <td className="num">{now == null ? "—" : `${Math.round(now * 100)}¢`}</td>
                      <td className="num pos">{amt(b.qty * unit)}</td>
                      <td className="small">{m?.closed ? "Locked" : m?.gameId ? "At kickoff" : "At settlement"}</td>
                      <td className="nw small">{day(b.placed)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot><tr><td>Total</td><td /><td className="num">{amt(staked)}</td><td /><td /><td className="num">{amt(toWin)}</td><td /><td /></tr></tfoot>
            </table>
          </div>
        ) : <p className="muted">No open bets.</p>}
      </section>

      <section className="panel">
        <div className="section-head"><h3>Settled bets</h3><Link href={`/l/${slug}/markets/activity`}>Full trade log →</Link></div>
        {done.length ? (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Bet</th><th className="num">Contracts</th><th className="num">Cost{cur}</th><th>Result</th><th className="num">Paid back</th><th className="num">Profit</th><th>Closed</th></tr></thead>
              <tbody>
                {done.map((b, i) => {
                  const p = (b.payout || 0) - b.cost;
                  return (
                    <tr key={i}>
                      <BetCell b={b} />
                      <td className="num">{Math.round(b.qty).toLocaleString("en-US")}</td>
                      <td className="num">{amt(b.cost)}</td>
                      <td><span className={`mk-result ${b.result}`}>{b.result === "won" ? "Won" : b.result === "lost" ? "Lost" : "Cancelled"}</span></td>
                      <td className="num">{amt(b.payout || 0)}</td>
                      <td className={`num ${b.result === "cancelled" ? "muted" : p > 0.004 ? "pos" : p < -0.004 ? "neg" : ""}`}>{b.result === "cancelled" ? "—" : `${p >= 0 ? "+" : ""}${amt(p)}`}</td>
                      <td className="nw small">{day(b.closedAt!)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <p className="muted">Nothing settled yet. Bets show here once their game is played or their market settles.</p>}
      </section>
    </div>
  );
}
