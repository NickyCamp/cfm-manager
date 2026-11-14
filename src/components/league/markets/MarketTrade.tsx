"use client";
import type React from "react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { prices, quoteBuy, type PriceIndex } from "@/lib/league/marketTypes";
import type { SharedState } from "@/lib/marketStore";
import { Chance, Delta, MiniBadge, type TeamLite } from "./bits";
import type { BoardOutcome } from "./MarketsBoard";
import { PortfolioPanel } from "./PortfolioPanel";
import { money, sellValue, usePortfolio, type Side } from "./usePortfolio";

export type TradeOutcome = BoardOutcome & { player?: number; color?: string; model?: number; net?: number };

export function MarketTrade({ slug, mkey, title, settled, closed, outcomes, hidden, teams, index, initialO, initialSide, shared, kickoff }: {
  slug: string; mkey: string; title: string; settled: boolean; closed?: boolean; kickoff?: React.ReactNode; outcomes: TradeOutcome[]; hidden: number;
  teams: TeamLite[]; index: PriceIndex; initialO?: string; initialSide?: string; shared?: SharedState | null;
}) {
  const port = usePortfolio(slug, index, shared);
  const [busy, setBusy] = useState(false);
  const teamMap = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);
  const firstOpen = outcomes.find((o) => o.state === "open");
  const [sel, setSel] = useState<string | undefined>(outcomes.some((o) => o.id === initialO && o.state === "open") ? initialO : firstOpen?.id);
  const [side, setSide] = useState<Side>(initialSide === "no" ? "no" : "yes");
  const T = shared?.currency === "tickets";
  const unit = shared?.unit ?? 1;
  const [amount, setAmount] = useState(T ? "1000" : "25");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [showAll, setShowAll] = useState(false);

  const o = outcomes.find((x) => x.id === sel);
  const pr = o ? prices(o) : null;
  const price = pr ? (side === "yes" ? pr.yes : pr.no) : 0;
  const dollars = Math.max(0, Number(amount) || 0);
  const cash = port.wallet?.cash ?? 0;
  // shared mode: the price slides as you buy, so quote the whole order
  const q = o && port.shared ? quoteBuy(o.model ?? o.p, o.net ?? 0, side, Math.min(dollars, T && port.needsLink ? dollars : cash) / unit) : null;
  const qty = q ? q.qty : price > 0 ? Math.floor((Math.min(dollars, cash) * 100) / price + 1e-9) : 0;
  const cost = q ? (T ? Math.ceil(q.amount * unit - 1e-6) : q.amount) : (qty * price) / 100;
  const fmt = port.fmt;
  const held = port.wallet?.positions.find((p) => p.m === mkey && p.o === sel && p.side === side);
  const heldValue = held && o ? sellValue(index, mkey, o.id, side, held.qty, port.shared, unit) : 0;

  const choose = (id: string, s: Side) => {
    setSel(id); setSide(s); setMsg(null);
    // phones: the ticket sits below the list, so bring it into view
    if (window.innerWidth < 960) requestAnimationFrame(() => document.querySelector(".mk-ticket")?.scrollIntoView({ behavior: "smooth", block: "center" }));
  };
  const run = async (f: () => Promise<{ ok: boolean; text: string }>) => {
    setBusy(true); setMsg(null);
    try { setMsg(await f()); } finally { setBusy(false); }
  };
  const doBuy = () => o && run(() => port.buy(mkey, o.id, side, dollars));
  const doSell = () => o && held && run(() => port.sell(mkey, o.id, side, held.qty));

  const list = showAll ? outcomes : outcomes.slice(0, 12);

  return (
    <div className="mk-layout detail">
      <div className="mk-main">
        <div className="panel mk-outcomes">
          <div className="mk-out-head"><span>Outcome</span><span>Chance</span><span className="mk-btns-h">{settled ? "Result" : closed ? "Closed" : "Buy"}</span></div>
          <ul className="mk-rows big">
            {list.map((x) => {
              const p = prices(x);
              const team = x.team ? teamMap.get(x.team) : undefined;
              const active = x.id === sel;
              return (
                <li key={x.id} className={`mk-row ${x.state}${active ? " active" : ""}`}>
                  {x.color && <span className="mk-swatch" style={{ background: x.color }} aria-hidden />}
                  {team ? <MiniBadge team={team} size={28} /> : <span className="mk-dot" aria-hidden />}
                  <span className="mk-row-label">
                    <span className="mk-row-name">{x.player ? <Link href={`/l/${slug}/players/${x.player}`}>{x.label}</Link> : x.label}</span>
                    {x.sub && <span className="mk-row-sub">{x.sub}</span>}
                  </span>
                  <span className="mk-row-chance"><Chance p={x.p} state={x.state} /><Delta p={x.p} prev={x.prev} state={x.state} /></span>
                  {x.state === "open" && !closed ? (
                    <span className="mk-btns">
                      <button type="button" className={`mk-btn yes${active && side === "yes" ? " on" : ""}`} onClick={() => choose(x.id, "yes")}>Yes {p.yes}¢</button>
                      <button type="button" className={`mk-btn no${active && side === "no" ? " on" : ""}`} onClick={() => choose(x.id, "no")}>No {p.no}¢</button>
                    </span>
                  ) : (
                    <span className="mk-btns"><span className={`mk-result ${x.state}`}>{x.state === "won" ? "Yes ✓" : x.state === "lost" ? "No" : "Closed"}</span></span>
                  )}
                </li>
              );
            })}
          </ul>
          {outcomes.length > 12 && <button type="button" className="mk-link-btn mk-more" onClick={() => setShowAll((s) => !s)}>{showAll ? "Show fewer" : `Show all ${outcomes.length}`}</button>}
          {hidden > 0 && <p className="hint small">{hidden} long shots that never reached 1% aren&apos;t listed.</p>}
        </div>
      </div>

      <div className="mk-side-col">
        {kickoff}
        {closed && !settled && <div className="panel mk-ticket"><p className="mk-msg err">Betting on this game is closed. Positions pay out when the result syncs.</p></div>}
        {!settled && !closed && o && pr && (
          <div className="panel mk-ticket" aria-label="Order ticket">
            <div className="mk-ticket-head">
              {o.team ? <MiniBadge team={teamMap.get(o.team)} size={30} /> : null}
              <div><strong>{o.label}</strong><div className="muted small">{title}</div></div>
            </div>
            <div className="mk-side-toggle" role="group" aria-label="Side">
              <button type="button" className={`mk-btn yes${side === "yes" ? " on" : ""}`} aria-pressed={side === "yes"} onClick={() => { setSide("yes"); setMsg(null); }}>Yes {pr.yes}¢</button>
              <button type="button" className={`mk-btn no${side === "no" ? " on" : ""}`} aria-pressed={side === "no"} onClick={() => { setSide("no"); setMsg(null); }}>No {pr.no}¢</button>
            </div>
            <label className="mk-amount">
              <span>Amount</span>
              <span className="mk-amount-input">{!T && <span>$</span>}<input inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value.replace(T ? /[^\d]/g : /[^\d.]/g, "")); setMsg(null); }} aria-label={T ? "Tickets to spend" : "Dollars to spend"} />{T && <span className="mk-unit">Tickets</span>}</span>
            </label>
            <div className="mk-quick">
              {(T ? [1000, 5000, 15000] : [10, 25, 100]).map((n) => <button key={n} type="button" onClick={() => setAmount(String((Number(amount) || 0) + n))}>+{T ? n.toLocaleString("en-US") : `$${n}`}</button>)}
              <button type="button" onClick={() => setAmount(String(Math.floor(cash)))}>Max</button>
            </div>
            <dl className="mk-ticket-sum">
              <div><dt>Contracts</dt><dd>{qty}</dd></div>
              {q && qty > 0 && <div><dt>Average price</dt><dd>{Math.round(q.avg * 1000) / 10}¢</dd></div>}
              {q && qty > 0 && <div><dt>Yes price after</dt><dd>{Math.round(q.after * 100)}¢</dd></div>}
              <div><dt>Cost</dt><dd>{fmt(cost)}</dd></div>
              <div><dt>Payout if {side === "yes" ? "Yes" : "No"}</dt><dd className="pos">{fmt(qty * unit)}</dd></div>
              <div><dt>Profit if right</dt><dd className="pos">+{fmt(qty * unit - cost)}</dd></div>
            </dl>
            {port.canTrade ? (
              <button type="button" className={`btn mk-buy ${side}`} disabled={!port.wallet || qty < 1 || busy} onClick={doBuy}>
                {busy ? "Placing…" : <>Buy {side === "yes" ? "Yes" : "No"}{qty ? ` · ${fmt(cost)}` : ""}</>}
              </button>
            ) : (
              <p className="mk-msg err">{port.why}</p>
            )}
            {held && port.canTrade && <button type="button" className="mk-link-btn mk-sell" disabled={busy} onClick={doSell}>Sell your {held.qty} {side === "yes" ? "Yes" : "No"} for {fmt(heldValue)}</button>}
            {msg && <p className={`mk-msg ${msg.ok ? "ok" : "err"}`} role="status">{msg.text}</p>}
            <p className="hint small">{T ? (port.needsLink ? "" : `You have ${fmt(cash)}. `) : `Cash: ${money(cash)}. `}Each contract pays {T ? "100 Tickets" : "$1"} if {side === "yes" ? `${o.label} hits` : `${o.label} misses`}.{port.shared ? " Buying moves the price for everyone, so big orders cost more per contract." : ""}</p>
            {port.shared && o.model != null && Math.abs(o.model - o.p) >= 0.005 && <p className="hint small">Simulation says {Math.round(o.model * 100)}%; league bets have moved it to {Math.round(o.p * 100)}%.</p>}
          </div>
        )}
        <PortfolioPanel slug={slug} index={index} port={port} onlyMarket={mkey} />
      </div>
    </div>
  );
}
