"use client";
import Link from "next/link";
import { useState } from "react";
import type { PriceIndex } from "@/lib/league/marketTypes";
import { money, outcomeInfo, sellValue, sidePrice, START_CASH, type usePortfolio } from "./usePortfolio";

type Port = ReturnType<typeof usePortfolio>;

export function PortfolioPanel({ slug, index, port, onlyMarket }: { slug: string; index: PriceIndex; port: Port; onlyMarket?: string }) {
  const { wallet, sell, reset, value, total } = port;
  const [confirmReset, setConfirmReset] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const sellAll = async (m: string, o: string, side: "yes" | "no", qty: number) => {
    setBusy(true);
    try { setNote(await sell(m, o, side, qty)); } finally { setBusy(false); }
  };
  if (!wallet) return <aside className="panel mk-port"><h3>Your portfolio</h3><p className="muted">Loading…</p></aside>;
  const pl = total - START_CASH;
  const positions = wallet.positions.filter((p) => !onlyMarket || p.m === onlyMarket);
  const fills = wallet.fills.filter((f) => !onlyMarket || f.m === onlyMarket).slice(0, onlyMarket ? 8 : 5);

  return (
    <aside className="panel mk-port" aria-label="Your play-money portfolio">
      <div className="mk-port-head">
        <h3>{onlyMarket ? "Your position" : "Your portfolio"}</h3>
        <span className="tag">{port.shared ? "League play money" : "Play money"}</span>
      </div>
      <div className="mk-port-stats">
        <div><span>Cash</span><strong>{money(wallet.cash)}</strong></div>
        <div><span>Positions</span><strong>{money(value)}</strong></div>
        <div><span>Total</span><strong>{money(total)}</strong></div>
        <div><span>Profit / loss</span><strong className={pl > 0.004 ? "pos" : pl < -0.004 ? "neg" : ""}>{pl >= 0 ? "+" : ""}{money(pl)}</strong></div>
      </div>

      {positions.length > 0 ? (
        <ul className="mk-pos-list">
          {positions.map((p) => {
            const info = outcomeInfo(index, p.m, p.o);
            const price = sidePrice(index, p.m, p.o, p.side);
            const val = (p.qty * price) / 100;
            const gain = val - p.cost;
            const out = sellValue(index, p.m, p.o, p.side, p.qty, port.shared);
            return (
              <li key={`${p.m}:${p.o}:${p.side}`}>
                <div className="mk-pos-top">
                  <span className={`mk-side ${p.side}`}>{p.side === "yes" ? "Yes" : "No"}</span>
                  <span className="mk-pos-label">{info?.label ?? p.o}</span>
                </div>
                {!onlyMarket && <Link className="mk-pos-market" href={`/l/${slug}/markets/${p.m}`}>{info?.title ?? p.m}</Link>}
                <div className="mk-pos-nums">
                  <span>{p.qty} @ {Math.round((p.cost / p.qty) * 100)}¢</span>
                  <span>now {price}¢</span>
                  <span className={gain > 0.004 ? "pos" : gain < -0.004 ? "neg" : ""}>{money(val)} ({gain >= 0 ? "+" : ""}{money(gain)})</span>
                </div>
                <div className="mk-pos-actions">
                  <span className="muted small">Pays {money(p.qty)} if right</span>
                  {price > 0 && price < 100 && port.canTrade && <button type="button" className="mk-link-btn" disabled={busy} onClick={() => sellAll(p.m, p.o, p.side, p.qty)}>Sell all for {money(out)}</button>}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="muted small mk-empty">{onlyMarket ? "You don't hold anything in this market yet." : "No positions yet. Tap a Yes or No price to open a ticket."}</p>
      )}

      {note && <p className={`mk-msg ${note.ok ? "ok" : "err"}`} role="status">{note.text}</p>}
      {fills.length > 0 && (
        <details className="mk-fills" open={Boolean(onlyMarket)}>
          <summary>Recent activity</summary>
          <ul>
            {fills.map((f, i) => {
              const info = outcomeInfo(index, f.m, f.o);
              const verb = f.kind === "buy" ? "Bought" : f.kind === "sell" ? "Sold" : f.amount > 0 ? "Paid out" : "Expired";
              return (
                <li key={i}>
                  <span>{verb} {f.qty} {f.side === "yes" ? "Yes" : "No"} · {info?.label ?? f.o}{f.kind !== "settle" ? ` @ ${f.price}¢` : ""}</span>
                  <span className={f.kind === "buy" ? "" : f.amount > 0 ? "pos" : "neg"}>{f.kind === "buy" ? "−" : "+"}{money(f.amount)}</span>
                </li>
              );
            })}
          </ul>
        </details>
      )}

      {!onlyMarket && port.shared && port.leaderboard.length > 0 && (
        <div className="mk-board">
          <h4>League leaderboard</h4>
          <ol>
            {port.leaderboard.slice(0, 32).map((r, i) => (
              <li key={i} className={r.you ? "you" : undefined}>
                <span className="rk">{i + 1}</span>
                <span className="nm">{r.name}{r.team ? <span className="muted"> · {r.team}</span> : null}{r.you ? <span className="muted"> (you)</span> : null}</span>
                <span className={r.total > START_CASH + 0.004 ? "pos" : r.total < START_CASH - 0.004 ? "neg" : ""}>{money(r.total)}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
      {!onlyMarket && !port.shared && (
        <div className="mk-reset">
          {confirmReset ? (
            <>
              <span className="small">Wipe positions and start over at {money(START_CASH)}?</span>
              <button type="button" className="mk-link-btn danger" onClick={() => { reset(); setConfirmReset(false); }}>Yes, reset</button>
              <button type="button" className="mk-link-btn" onClick={() => setConfirmReset(false)}>Cancel</button>
            </>
          ) : (
            <button type="button" className="mk-link-btn" onClick={() => setConfirmReset(true)}>Reset to {money(START_CASH)}</button>
          )}
        </div>
      )}
      {!port.canTrade && <p className="mk-msg err">{port.why}</p>}
      <p className="hint small">{port.shared ? "Fake money, one wallet per league member this season. Prices move with everyone's bets: buy early for a better price." : "Fake money, saved on this device only."} Contracts pay $1 if right, $0 if wrong.</p>
    </aside>
  );
}
