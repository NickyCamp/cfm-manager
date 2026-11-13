"use client";
// Play-money portfolio for a league's markets.
// - Shared mode (once supabase/migrations/0003_markets.sql has run): one wallet per
//   league member per season on the server; buying and selling moves the price for
//   everyone (crowd pricing in marketTypes.ts), so early bets get better prices.
// - Local mode (before that, or in local dev): a wallet in this browser at the
//   simulation's price.
// Contracts pay $1 if right; finished markets pay out automatically.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { prices, quoteSell, type OutcomeState, type PriceIndex } from "@/lib/league/marketTypes";
import type { SharedState } from "@/lib/marketStore";

export const START_CASH = 1000;
export type Side = "yes" | "no";
export type Position = { m: string; o: string; side: Side; qty: number; cost: number };
export type Fill = { at: number; m: string; o: string; side: Side; qty: number; price: number; kind: "buy" | "sell" | "settle"; amount: number };
export type Wallet = { v: 1; cash: number; positions: Position[]; fills: Fill[]; started: number };
export type TradeResult = { ok: boolean; text: string };

const keyFor = (slug: string) => `cfm-markets-v1:${slug}`;
const fresh = (): Wallet => ({ v: 1, cash: START_CASH, positions: [], fills: [], started: Date.now() });
const round2 = (x: number) => Math.round(x * 100) / 100;

function load(slug: string): Wallet {
  try {
    const raw = localStorage.getItem(keyFor(slug));
    if (raw) { const w = JSON.parse(raw) as Wallet; if (w && w.v === 1) return w; }
  } catch { /* storage blocked or bad JSON: start over */ }
  return fresh();
}
function save(slug: string, w: Wallet) {
  try { localStorage.setItem(keyFor(slug), JSON.stringify(w)); } catch { /* private mode etc. */ }
}

export function outcomeInfo(index: PriceIndex, m: string, o: string) {
  const mk = index[m]; const x = mk?.o[o];
  return x ? { p: x[0], state: x[1] as OutcomeState, label: x[2], model: x[3], net: x[4], title: mk.t } : null;
}
/** Current price of one side, in cents. */
export function sidePrice(index: PriceIndex, m: string, o: string, side: Side) {
  const i = outcomeInfo(index, m, o);
  if (!i) return 0;
  const pr = prices(i);
  return side === "yes" ? pr.yes : pr.no;
}
/** Dollars you'd get selling `qty` now (shared mode: the price slides as you sell). */
export function sellValue(index: PriceIndex, m: string, o: string, side: Side, qty: number, shared: boolean) {
  const i = outcomeInfo(index, m, o);
  if (!i) return 0;
  if (i.state !== "open") return (i.state === "won") === (side === "yes") ? qty : 0;
  if (!shared) return round2((qty * sidePrice(index, m, o, side)) / 100);
  return quoteSell(i.model, i.net, side, qty).amount;
}

/** Pays out local positions whose outcome has settled. Returns the same object when nothing changed. */
function settle(w: Wallet, index: PriceIndex): Wallet {
  let changed = false;
  const keep: Position[] = [];
  const fills = [...w.fills];
  let cash = w.cash;
  for (const pos of w.positions) {
    const i = outcomeInfo(index, pos.m, pos.o);
    if (!i || i.state === "open") { keep.push(pos); continue; }
    const wins = (i.state === "won") === (pos.side === "yes");
    const amount = wins ? pos.qty : 0;
    cash += amount;
    fills.unshift({ at: Date.now(), m: pos.m, o: pos.o, side: pos.side, qty: pos.qty, price: wins ? 100 : 0, kind: "settle", amount });
    changed = true;
  }
  return changed ? { ...w, cash: round2(cash), positions: keep, fills: fills.slice(0, 200) } : w;
}

export function usePortfolio(slug: string, index: PriceIndex, shared?: SharedState | null) {
  const router = useRouter();
  const [local, setLocal] = useState<Wallet | null>(null);

  useEffect(() => {
    if (shared) return;
    const first = settle(load(slug), index);
    save(slug, first);
    setLocal(first);
    const onStorage = (e: StorageEvent) => { if (e.key === keyFor(slug)) setLocal(load(slug)); };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [slug, index, shared]);

  const commit = useCallback((next: Wallet) => { save(slug, next); setLocal(next); }, [slug]);

  const wallet: Wallet | null = shared
    ? { v: 1, cash: shared.cash, positions: shared.positions, fills: shared.fills, started: 0 }
    : local;
  const canTrade = shared ? shared.member : true;
  const why = shared && !shared.member ? (shared.signedIn ? "Only members of this league can trade." : "Sign in as a member of this league to trade.") : "";

  const call = useCallback(async (body: Record<string, unknown>): Promise<{ ok: boolean; qty?: number; amount?: number; error?: string }> => {
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(slug)}/markets`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: j.error || "Trade failed." };
      router.refresh();
      return { ok: true, qty: j.qty, amount: j.amount };
    } catch {
      return { ok: false, error: "Couldn't reach the server." };
    }
  }, [slug, router]);

  /** Spend up to `dollars` on one side. */
  const buy = useCallback(async (m: string, o: string, side: Side, dollars: number): Promise<TradeResult> => {
    const label = outcomeInfo(index, m, o)?.label ?? o;
    const sideName = side === "yes" ? "Yes" : "No";
    if (shared) {
      const r = await call({ market: m, outcome: o, side, kind: "buy", dollars });
      return r.ok ? { ok: true, text: `Bought ${r.qty} ${sideName} on ${label} for ${money(r.amount!)}. Pays ${money(r.qty!)} if right.` } : { ok: false, text: r.error! };
    }
    const cur = load(slug);
    const price = sidePrice(index, m, o, side);
    if (price <= 0 || price >= 100) return { ok: false, text: "That market has closed." };
    const qty = Math.floor(Math.min(dollars, cur.cash) * 100 / price + 1e-9);
    if (qty < 1) return { ok: false, text: dollars > cur.cash ? "Not enough cash." : "That's not enough for one contract." };
    const cost = round2(qty * price / 100);
    const positions = [...cur.positions];
    const at = positions.findIndex((p) => p.m === m && p.o === o && p.side === side);
    if (at >= 0) positions[at] = { ...positions[at], qty: positions[at].qty + qty, cost: round2(positions[at].cost + cost) };
    else positions.push({ m, o, side, qty, cost });
    commit({ ...cur, cash: round2(cur.cash - cost), positions, fills: [{ at: Date.now(), m, o, side, qty, price, kind: "buy" as const, amount: cost }, ...cur.fills].slice(0, 200) });
    return { ok: true, text: `Bought ${qty} ${sideName} on ${label} for ${money(cost)}. Pays ${money(qty)} if right.` };
  }, [slug, index, commit, shared, call]);

  /** Sell `qty` contracts back at the current price. */
  const sell = useCallback(async (m: string, o: string, side: Side, qty: number): Promise<TradeResult> => {
    const sideName = side === "yes" ? "Yes" : "No";
    if (shared) {
      const r = await call({ market: m, outcome: o, side, kind: "sell", qty });
      return r.ok ? { ok: true, text: `Sold ${r.qty} ${sideName} for ${money(r.amount!)}.` } : { ok: false, text: r.error! };
    }
    const cur = load(slug);
    const at = cur.positions.findIndex((p) => p.m === m && p.o === o && p.side === side);
    if (at < 0) return { ok: false, text: "Nothing to sell." };
    const pos = cur.positions[at];
    const n = Math.min(Math.max(1, Math.floor(qty)), pos.qty);
    const price = sidePrice(index, m, o, side);
    const amount = round2(n * price / 100);
    const positions = [...cur.positions];
    if (n === pos.qty) positions.splice(at, 1);
    else positions[at] = { ...pos, qty: pos.qty - n, cost: round2(pos.cost * (pos.qty - n) / pos.qty) };
    commit({ ...cur, cash: round2(cur.cash + amount), positions, fills: [{ at: Date.now(), m, o, side, qty: n, price, kind: "sell" as const, amount }, ...cur.fills].slice(0, 200) });
    return { ok: true, text: `Sold ${n} ${sideName} for ${money(amount)}.` };
  }, [slug, index, commit, shared, call]);

  const reset = useCallback(() => { if (!shared) commit(fresh()); }, [commit, shared]);

  const value = wallet ? wallet.positions.reduce((a, p) => a + p.qty * sidePrice(index, p.m, p.o, p.side) / 100, 0) : 0;
  return { wallet, buy, sell, reset, value: round2(value), total: wallet ? round2(wallet.cash + value) : START_CASH, shared: Boolean(shared), canTrade, why, leaderboard: shared?.leaderboard ?? [] };
}

export const money = (x: number) => `${x < 0 ? "−" : ""}$${Math.abs(x).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
