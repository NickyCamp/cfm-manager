import { after, NextResponse } from "next/server";

export const maxDuration = 30;
import { getLeagueData } from "@/lib/league/load";
import { marketBook } from "@/lib/league/markets";
import { closeTimes, fmtET, marketsShared, marketsStatus, placeTicketsTrade, placeTrade, viewer } from "@/lib/marketStore";
import { bookKey, ticketsConfig } from "@/lib/tickets";
import { liveWeek, weekMoved } from "@/lib/eaLive";
import { requestSync } from "@/lib/sync";

// GET: is shared trading on, and if not, why (no secrets). For checking setup.
export async function GET() {
  return NextResponse.json(await marketsStatus(), { headers: { "cache-control": "no-store" } });
}

// POST { market, outcome, side: "yes"|"no", kind: "buy"|"sell", dollars?, qty? }
// League members only. Prices are worked out here from the simulation + members' trades.
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!(await marketsShared())) return NextResponse.json({ error: "Shared trading isn't set up yet." }, { status: 503 });
  const v = await viewer(slug);
  if (!v.userId) return NextResponse.json({ error: "Sign in to trade." }, { status: 401 });
  if (!v.member || !v.leagueId) return NextResponse.json({ error: "Only members of this league can trade." }, { status: 403 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const market = String(body?.market ?? ""), outcome = String(body?.outcome ?? "");
  const side = body?.side === "no" ? "no" : body?.side === "yes" ? "yes" : null;
  const kind = body?.kind === "sell" ? "sell" : body?.kind === "buy" ? "buy" : null;
  // amount: dollars (play money) or Tickets, in the league's currency
  const dollars = Number(body?.amount ?? body?.dollars), qty = Number(body?.qty);
  if (!side || !kind) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  if (kind === "buy" && !(dollars > 0 && dollars <= 100_000_000)) return NextResponse.json({ error: "Enter an amount." }, { status: 400 });
  if (kind === "sell" && !(qty >= 1)) return NextResponse.json({ error: "Nothing to sell." }, { status: 400 });

  const d = await getLeagueData(slug);
  if (!d) return NextResponse.json({ error: "No league data yet." }, { status: 404 });
  const m = marketBook(d).markets.find((x) => x.key === market);
  const o = m?.outcomes.find((x) => x.id === outcome);
  if (!m || !o) return NextResponse.json({ error: "That market doesn't exist any more." }, { status: 404 });
  if (m.settled || o.state !== "open") return NextResponse.json({ error: "That market has closed." }, { status: 409 });

  // Game and player-prop markets: closed at the scheduled kickoff, and the moment EA says the game was played.
  if (m.gameId) {
    const c = (await closeTimes(v.leagueId, d.season.year)).get(m.gameId);
    if (c && Date.parse(c.closeAt) <= Date.now()) return NextResponse.json({ error: `Betting on this game closed at kickoff (${fmtET(c.closeAt)}).` }, { status: 409 });
    const live = await liveWeek(slug, { fresh: true });
    if (live && (live.played.has(m.gameId) || weekMoved(live, d.season))) {
      after(() => requestSync(slug, { minGapMs: 10 * 60_000, mode: "auto", by: "market-close" }).then(() => {}, () => {}));
      return NextResponse.json({ error: "EA says this game has been played, so betting is closed. It settles at the next sync." }, { status: 409 });
    }
    if (!live && !(c && Date.parse(c.closeAt) > Date.now())) {
      return NextResponse.json({ error: "Couldn't check with EA that this game hasn't been played yet. Set a kickoff time for it (/kickoff in Discord or on the market page) and betting stays open until then." }, { status: 503 });
    }
  }

  const tickets = await ticketsConfig(slug).catch(() => null);
  const r = tickets
    ? await placeTicketsTrade({ leagueId: v.leagueId, book: bookKey(d.season.year, true), userId: v.userId, market, marketTitle: m.title, outcome, outcomeLabel: o.label, side, kind, model: o.p, tickets: dollars, qty, cfg: tickets })
    : dollars > 100000 ? { ok: false as const, error: "Too much." } : await placeTrade({ leagueId: v.leagueId, season: d.season.year, userId: v.userId, market, outcome, side, kind, model: o.p, dollars, qty });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 409 });
  return NextResponse.json(r);
}
