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
