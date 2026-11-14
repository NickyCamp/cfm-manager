// Shared by the market engine (server) and the market pages' client components.

export type MarketCat = "games" | "props" | "champion" | "conference" | "division" | "playoffs" | "awards" | "leaders" | "wins";
export const CATS: { key: MarketCat; label: string }[] = [
  { key: "games", label: "Games" },
  { key: "props", label: "Player props" },
  { key: "champion", label: "Super Bowl" },
  { key: "conference", label: "Conferences" },
  { key: "division", label: "Divisions" },
  { key: "playoffs", label: "Playoffs" },
  { key: "awards", label: "Awards" },
  { key: "leaders", label: "Stat leaders" },
  { key: "wins", label: "Win totals" },
];

export type OutcomeState = "open" | "won" | "lost";
export type Outcome = {
  id: string;
  label: string;
  sub?: string;
  team?: number;           // team id for the badge
  player?: number;         // player id for a link
  p: number;               // chance of Yes, 0..1
  prev: number | null;     // chance at the previous checkpoint
  history: (number | null)[]; // one per checkpoint (null = market didn't exist yet)
  state: OutcomeState;
  model?: number;          // the simulation's chance, when members' trades have moved p
  net?: number;            // Yes minus No contracts bought by members
  volume?: number;         // dollars traded
};
export type Market = {
  key: string;
  cat: MarketCat;
  title: string;
  subtitle: string;
  kind: "exclusive" | "independent"; // exclusive: exactly one outcome wins
  settled: boolean;
  status: string;          // "Open", "Settled", "Closes after Week 18"…
  rules: string;
  outcomes: Outcome[];
  gameId?: number;         // game and player-prop markets: the game they're about
  closed?: boolean;        // trading stopped (game played, waiting for the sync to settle it)
};
export type Checkpoint = { c: number; label: string };
export type MarketBook = { markets: Market[]; checkpoints: Checkpoint[]; sinceLabel: string | null; season: number; asOfTitle: string };

/** Every outcome's chance and state, for valuing play-money positions on any page. */
/** [chance shown (crowd), state, label, simulation chance, net contracts] */
export type PriceIndex = Record<string, { t: string; o: Record<string, [number, OutcomeState, string, number, number]> }>;
export function priceIndex(book: MarketBook): PriceIndex {
  const out: PriceIndex = {};
  for (const m of book.markets) out[m.key] = { t: m.title, o: Object.fromEntries(m.outcomes.map((o) => [o.id, [Math.round(o.p * 10000) / 10000, o.state, o.label, o.model ?? o.p, o.net ?? 0]])) };
  return out;
}

/** Kalshi-style prices in cents. Open outcomes trade between 1¢ and 99¢. */
export function prices(o: Pick<Outcome, "p" | "state">) {
  if (o.state === "won") return { yes: 100, no: 0 };
  if (o.state === "lost") return { yes: 0, no: 100 };
  const yes = Math.min(99, Math.max(1, Math.round(o.p * 100)));
  return { yes, no: 100 - yes };
}

export function chanceText(p: number, state: OutcomeState = "open") {
  if (state === "won") return "Won";
  if (state === "lost") return "Out";
  if (p >= 0.995) return ">99%";
  if (p > 0 && p < 0.005) return "<1%";
  return `${Math.round(p * 100)}%`;
}

// ---------------------------------------------------------------- crowd pricing
// Each outcome is its own Yes/No market run by an automated market maker
// (a logarithmic market scoring rule) that starts at the simulation's chance:
//   price of Yes = logistic(logit(model chance) + net / LIQUIDITY)
// where net = Yes contracts bought minus No contracts bought by everyone.
// Buying pushes the price up as you buy, so the first buyer gets the best
// price; later buyers pay more. When a sync moves the model, the crowd's tilt
// stays on top of it. LIQUIDITY sets how hard money moves prices: with 250,
// $50 of Yes at 50¢ moves it to about 59¢.

export const LIQUIDITY = 250;
const clampP = (p: number) => Math.min(0.99, Math.max(0.01, p));
const logit = (p: number) => Math.log(p / (1 - p));
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
const softplus = (x: number) => (x > 30 ? x : Math.log1p(Math.exp(x)));

/** Yes chance after the crowd's buying and selling. */
export function crowdP(model: number, net: number) {
  return sigmoid(logit(clampP(model)) + net / LIQUIDITY);
}
/** Dollars to buy n contracts of one side, starting from `net`. */
export function buyCostBinary(model: number, net: number, side: "yes" | "no", n: number) { return buyCost(model, net, side, n); }
function buyCost(model: number, net: number, side: "yes" | "no", n: number) {
  const x0 = logit(clampP(model)), b = LIQUIDITY;
  if (side === "yes") return b * (softplus(x0 + (net + n) / b) - softplus(x0 + net / b));
  return b * (softplus(-(x0 + (net - n) / b)) - softplus(-(x0 + net / b)));
}
export type Quote = { qty: number; amount: number; newNet: number; before: number; after: number; avg: number };
/** Most whole contracts `dollars` buys. */
export function quoteBuy(model: number, net: number, side: "yes" | "no", dollars: number): Quote {
  const before = crowdP(model, net);
  let lo = 0, hi = 1;
  while (buyCost(model, net, side, hi) <= dollars && hi < 1e6) hi *= 2;
  for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (buyCost(model, net, side, mid) <= dollars) lo = mid; else hi = mid; }
  const qty = Math.floor(lo + 1e-9);
  const amount = Math.ceil(buyCost(model, net, side, qty) * 100 - 1e-6) / 100;
  const newNet = side === "yes" ? net + qty : net - qty;
  return { qty, amount, newNet, before, after: crowdP(model, newNet), avg: qty ? amount / qty : 0 };
}
/** Dollars back for selling `qty` contracts of one side. */
export function quoteSell(model: number, net: number, side: "yes" | "no", qty: number): Quote {
  const before = crowdP(model, net);
  const newNet = side === "yes" ? net - qty : net + qty;
  // selling n Yes = the reverse of buying n Yes from newNet
  const amount = Math.floor(buyCost(model, newNet, side, qty) * 100 + 1e-6) / 100;
  return { qty, amount, newNet, before, after: crowdP(model, newNet), avg: qty ? amount / qty : 0 };
}

// ---------------------------------------------------------------- linked prices (Nick, 2026-11-13)
// Bets move related prices too, right up to kickoff:
// - One-winner markets (who wins a game, Super Bowl, divisions, awards…) are priced as one
//   multi-outcome market maker: price_i = softmax(log model_i + net_i / LIQUIDITY). Money on
//   one outcome raises it and lowers all the others; prices always add up to 100¢.
//   A No on outcome i is the same as Yes on all the others, so the same per-outcome net works.
// - Player-prop ladders (same player, same stat): a bet on one line also nudges the others
//   the same direction (LADDER_SPILL of its weight), so 250+ / 300+ / 350+ stay consistent.
// Everything else stays its own Yes/No market.

export const LADDER_SPILL = 0.5;
const lse = (xs: number[]) => { const m = Math.max(...xs); return m + Math.log(xs.reduce((a, x) => a + Math.exp(x - m), 0)); };

export type Pricer =
  | { kind: "binary"; model: number }
  | { kind: "exclusive"; logw: number[]; nets: number[]; i: number };

type PricedOutcome = { id: string; p: number; state: OutcomeState };
type PricedMarket = { key: string; kind: "exclusive" | "independent"; outcomes: PricedOutcome[] };

/** Prop ladder group: "<player>:<stat>" from an outcome id "<player>:<stat>:<strike>". */
export const ladderGroup = (marketKey: string, outcomeId: string) => {
  if (!marketKey.startsWith("props-")) return null;
  const parts = outcomeId.split(":");
  return parts.length === 3 ? `${parts[0]}:${parts[1]}` : null;
};

/** How one outcome is priced, given everyone's nets in its market. `model` values are the simulation's chances. */
export function pricerFor(m: PricedMarket, outcomeId: string, nets: Map<string, number>): Pricer {
  const o = m.outcomes.find((x) => x.id === outcomeId);
  const model = o?.p ?? 0.5;
  if (m.kind === "exclusive") {
    const open = m.outcomes.filter((x) => x.state === "open");
    const total = open.reduce((a, x) => a + Math.max(x.p, 0.001), 0);
    // lists that don't name everyone (awards): the unlisted rest is a hidden outcome nobody can bet
    const rest = 1 - total;
    const scale = total > 1 ? total : 1;
    return {
      kind: "exclusive",
      logw: [...open.map((x) => Math.log(Math.max(x.p, 0.001) / scale)), ...(rest > 0.001 ? [Math.log(rest)] : [])],
      nets: [...open.map((x) => nets.get(x.id) || 0), ...(rest > 0.001 ? [0] : [])],
      i: open.findIndex((x) => x.id === outcomeId),
    };
  }
  const g = ladderGroup(m.key, outcomeId);
  if (g) {
    let spill = 0;
    for (const x of m.outcomes) if (x.id !== outcomeId && ladderGroup(m.key, x.id) === g) spill += nets.get(x.id) || 0;
    return { kind: "binary", model: sigmoid(logit(clampP(model)) + (LADDER_SPILL * spill) / LIQUIDITY) };
  }
  return { kind: "binary", model };
}

function exState(pr: Extract<Pricer, { kind: "exclusive" }>, net: number) {
  const nets = pr.nets.slice(); nets[pr.i] = net;
  const xs = pr.logw.map((w, j) => w + nets[j] / LIQUIDITY);
  const z = lse(xs);
  return { cost: LIQUIDITY * z, p: Math.exp(xs[pr.i] - z) };
}
/** Yes chance of the outcome at its own `net` (everyone else's nets as in the pricer). */
export function pricedP(pr: Pricer, net: number) {
  return pr.kind === "binary" ? crowdP(pr.model, net) : exState(pr, net).p;
}
function costP(pr: Pricer, net: number, side: "yes" | "no", n: number) {
  if (pr.kind === "binary") return buyCostBinary(pr.model, net, side, n);
  const c0 = exState(pr, net).cost;
  return side === "yes" ? exState(pr, net + n).cost - c0 : n + exState(pr, net - n).cost - c0;
}
export function quoteBuyP(pr: Pricer, net: number, side: "yes" | "no", dollars: number): Quote {
  const before = pricedP(pr, net);
  let lo = 0, hi = 1;
  while (costP(pr, net, side, hi) <= dollars && hi < 1e6) hi *= 2;
  for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (costP(pr, net, side, mid) <= dollars) lo = mid; else hi = mid; }
  const qty = Math.floor(lo + 1e-9);
  const amount = Math.ceil(costP(pr, net, side, qty) * 100 - 1e-6) / 100;
  const newNet = side === "yes" ? net + qty : net - qty;
  return { qty, amount, newNet, before, after: pricedP(pr, newNet), avg: qty ? amount / qty : 0 };
}
export function quoteSellP(pr: Pricer, net: number, side: "yes" | "no", qty: number): Quote {
  const before = pricedP(pr, net);
  const newNet = side === "yes" ? net - qty : net + qty;
  const amount = Math.floor(costP(pr, newNet, side, qty) * 100 + 1e-6) / 100;
  return { qty, amount, newNet, before, after: pricedP(pr, newNet), avg: qty ? amount / qty : 0 };
}
