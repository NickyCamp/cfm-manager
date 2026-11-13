"use client";
// Play-money portfolio for a league's markets, kept in this browser
// (localStorage, one wallet per league). Every visitor starts with $1,000.
// Contracts cost the Yes or No price in cents and pay $1 if they're right;
// positions on settled markets are paid out automatically.

import { useCallback, useEffect, useState } from "react";
import { prices, type OutcomeState, type PriceIndex } from "@/lib/league/marketTypes";

export const START_CASH = 1000;
export type Side = "yes" | "no";
export type Position = { m: string; o: string; side: Side; qty: number; cost: number };
export type Fill = { at: number; m: string; o: string; side: Side; qty: number; price: number; kind: "buy" | "sell" | "settle"; amount: number };
export type Wallet = { v: 1; cash: number; positions: Position[]; fills: Fill[]; started: number };

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

export function outcomeInfo(index: PriceIndex, m: string, o: string): { p: number; state: OutcomeState; label: string; title: string } | null {
  const mk = index[m]; const x = mk?.o[o];
  return x ? { p: x[0], state: x[1], label: x[2], title: mk.t } : null;
}
/** Current price of one side, in cents. */
export function sidePrice(index: PriceIndex, m: string, o: string, side: Side) {
  const i = outcomeInfo(index, m, o);
  if (!i) return 0;
  const pr = prices(i);
  return side === "yes" ? pr.yes : pr.no;
}

/** Pays out positions whose outcome has settled. Returns the same object when nothing changed. */
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

export function usePortfolio(slug: string, index: PriceIndex) {
  const [w, setW] = useState<Wallet | null>(null);

  useEffect(() => {
    const first = settle(load(slug), index);
    save(slug, first);
    setW(first);
    const onStorage = (e: StorageEvent) => { if (e.key === keyFor(slug)) setW(load(slug)); };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [slug, index]);

  const commit = useCallback((next: Wallet) => { save(slug, next); setW(next); }, [slug]);

  /** Spend up to `dollars` on one side. Returns the contracts bought (0 = nothing done). */
  const buy = useCallback((m: string, o: string, side: Side, dollars: number) => {
    const cur = load(slug);
    const price = sidePrice(index, m, o, side);
    if (price <= 0 || price >= 100) return 0;
    const qty = Math.floor(Math.min(dollars, cur.cash) * 100 / price + 1e-9);
    if (qty < 1) return 0;
    const cost = round2(qty * price / 100);
    const positions = [...cur.positions];
    const at = positions.findIndex((p) => p.m === m && p.o === o && p.side === side);
    if (at >= 0) positions[at] = { ...positions[at], qty: positions[at].qty + qty, cost: round2(positions[at].cost + cost) };
    else positions.push({ m, o, side, qty, cost });
    commit({ ...cur, cash: round2(cur.cash - cost), positions, fills: [{ at: Date.now(), m, o, side, qty, price, kind: "buy" as const, amount: cost }, ...cur.fills].slice(0, 200) });
    return qty;
  }, [slug, index, commit]);

  /** Sell `qty` contracts back at the current price. Returns the dollars received. */
  const sell = useCallback((m: string, o: string, side: Side, qty: number) => {
    const cur = load(slug);
    const at = cur.positions.findIndex((p) => p.m === m && p.o === o && p.side === side);
    if (at < 0) return 0;
    const pos = cur.positions[at];
    const n = Math.min(Math.max(1, Math.floor(qty)), pos.qty);
    const price = sidePrice(index, m, o, side);
    const amount = round2(n * price / 100);
    const positions = [...cur.positions];
    if (n === pos.qty) positions.splice(at, 1);
    else positions[at] = { ...pos, qty: pos.qty - n, cost: round2(pos.cost * (pos.qty - n) / pos.qty) };
    commit({ ...cur, cash: round2(cur.cash + amount), positions, fills: [{ at: Date.now(), m, o, side, qty: n, price, kind: "sell" as const, amount }, ...cur.fills].slice(0, 200) });
    return amount;
  }, [slug, index, commit]);

  const reset = useCallback(() => commit(fresh()), [commit]);

  const value = w ? w.positions.reduce((a, p) => a + p.qty * sidePrice(index, p.m, p.o, p.side) / 100, 0) : 0;
  return { wallet: w, buy, sell, reset, value: round2(value), total: w ? round2(w.cash + value) : START_CASH };
}

export const money = (x: number) => `${x < 0 ? "−" : ""}$${Math.abs(x).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
