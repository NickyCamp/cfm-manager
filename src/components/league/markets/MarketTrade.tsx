"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { prices, type PriceIndex } from "@/lib/league/marketTypes";
import { Chance, Delta, MiniBadge, type TeamLite } from "./bits";
import type { BoardOutcome } from "./MarketsBoard";
import { PortfolioPanel } from "./PortfolioPanel";
import { money, usePortfolio, type Side } from "./usePortfolio";

export type TradeOutcome = BoardOutcome & { player?: number; color?: string };

export function MarketTrade({ slug, mkey, title, settled, outcomes, hidden, teams, index, initialO, initialSide }: {
  slug: string; mkey: string; title: string; settled: boolean; outcomes: TradeOutcome[]; hidden: number;
  teams: TeamLite[]; index: PriceIndex; initialO?: string; initialSide?: string;
}) {
  const port = usePortfolio(slug, index);
  const teamMap = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);
  const firstOpen = outcomes.find((o) => o.state === "open");
  const [sel, setSel] = useState<string | undefined>(outcomes.some((o) => o.id === initialO && o.state === "open") ? initialO : firstOpen?.id);
  const [side, setSide] = useState<Side>(initialSide === "no" ? "no" : "yes");
  const [amount, setAmount] = useState("25");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [showAll, setShowAll] = useState(false);

  const o = outcomes.find((x) => x.id === sel);
  const pr = o ? prices(o) : null;
  const price = pr ? (side === "yes" ? pr.yes : pr.no) : 0;
  const dollars = Math.max(0, Number(amount) || 0);
  const cash = port.wallet?.cash ?? 0;
  const qty = price > 0 ? Math.floor((Math.min(dollars, cash) * 100) / price + 1e-9) : 0;
  const cost = (qty * price) / 100;
  const held = port.wallet?.positions.find((p) => p.m === mkey && p.o === sel && p.side === side);

  const choose = (id: string, s: Side) => {
    setSel(id); setSide(s); setMsg(null);
    // phones: the ticket sits below the list, so bring it into view
    if (window.innerWidth < 960) requestAnimationFrame(() => document.querySelector(".mk-ticket")?.scrollIntoView({ behavior: "smooth", block: "center" }));
  };
  const doBuy = () => {
    if (!o) return;
    const n = port.buy(mkey, o.id, side, dollars);
    setMsg(n ? { ok: true, text: `Bought ${n} ${side === "yes" ? "Yes" : "No"} on ${o.label} for ${money((n * price) / 100)}. Pays ${money(n)} if right.` } : { ok: false, text: dollars > cash ? "Not enough cash." : "Amount too small for one contract." });
  };
  const doSell = () => {
    if (!o || !held) return;
    const got = port.sell(mkey, o.id, side, held.qty);
    setMsg({ ok: true, text: `Sold ${held.qty} ${side === "yes" ? "Yes" : "No"} for ${money(got)}.` });
  };

  const list = showAll ? outcomes : outcomes.slice(0, 12);

  return (
    <div className="mk-layout detail">
      <div className="mk-main">
        <div className="panel mk-outcomes">
          <div className="mk-out-head"><span>Outcome</span><span>Chance</span><span className="mk-btns-h">{settled ? "Result" : "Buy"}</span></div>
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
                  {x.state === "open" ? (
                    <span className="mk-btns">
                      <button type="button" className={`mk-btn yes${active && side === "yes" ? " on" : ""}`} onClick={() => choose(x.id, "yes")}>Yes {p.yes}¢</button>
                      <button type="button" className={`mk-btn no${active && side === "no" ? " on" : ""}`} onClick={() => choose(x.id, "no")}>No {p.no}¢</button>
                    </span>
                  ) : (
                    <span className="mk-btns"><span className={`mk-result ${x.state}`}>{x.state === "won" ? "Yes ✓" : "No"}</span></span>
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
        {!settled && o && pr && (
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
              <span className="mk-amount-input"><span>$</span><input inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value.replace(/[^\d.]/g, "")); setMsg(null); }} aria-label="Dollars to spend" /></span>
            </label>
            <div className="mk-quick">
              {[10, 25, 100].map((n) => <button key={n} type="button" onClick={() => setAmount(String((Number(amount) || 0) + n))}>+${n}</button>)}
              <button type="button" onClick={() => setAmount(String(Math.floor(cash)))}>Max</button>
            </div>
            <dl className="mk-ticket-sum">
              <div><dt>Contracts</dt><dd>{qty}</dd></div>
              <div><dt>Cost</dt><dd>{money(cost)}</dd></div>
              <div><dt>Payout if {side === "yes" ? "Yes" : "No"}</dt><dd className="pos">{money(qty)}</dd></div>
              <div><dt>Profit if right</dt><dd className="pos">+{money(qty - cost)}</dd></div>
            </dl>
            <button type="button" className={`btn mk-buy ${side}`} disabled={!port.wallet || qty < 1} onClick={doBuy}>
              Buy {side === "yes" ? "Yes" : "No"}{qty ? ` · ${money(cost)}` : ""}
            </button>
            {held && <button type="button" className="mk-link-btn mk-sell" onClick={doSell}>Sell your {held.qty} {side === "yes" ? "Yes" : "No"} for {money((held.qty * price) / 100)}</button>}
            {msg && <p className={`mk-msg ${msg.ok ? "ok" : "err"}`} role="status">{msg.text}</p>}
            <p className="hint small">Cash: {money(cash)}. Each contract pays $1 if {side === "yes" ? `${o.label} hits` : `${o.label} misses`}.</p>
          </div>
        )}
        <PortfolioPanel slug={slug} index={index} port={port} onlyMarket={mkey} />
      </div>
    </div>
  );
}
