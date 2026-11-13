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
};
export type Checkpoint = { c: number; label: string };
export type MarketBook = { markets: Market[]; checkpoints: Checkpoint[]; sinceLabel: string | null; season: number; asOfTitle: string };

/** Every outcome's chance and state, for valuing play-money positions on any page. */
export type PriceIndex = Record<string, { t: string; o: Record<string, [number, OutcomeState, string]> }>;
export function priceIndex(book: MarketBook): PriceIndex {
  const out: PriceIndex = {};
  for (const m of book.markets) out[m.key] = { t: m.title, o: Object.fromEntries(m.outcomes.map((o) => [o.id, [Math.round(o.p * 10000) / 10000, o.state, o.label]])) };
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
