import { NextResponse } from "next/server";
import { getLeagueData } from "@/lib/league/load";
import { marketBook } from "@/lib/league/markets";
import { marketsShared, placeTrade, viewer } from "@/lib/marketStore";

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
  const dollars = Number(body?.dollars), qty = Number(body?.qty);
  if (!side || !kind) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  if (kind === "buy" && !(dollars > 0 && dollars <= 100000)) return NextResponse.json({ error: "Enter an amount." }, { status: 400 });
  if (kind === "sell" && !(qty >= 1)) return NextResponse.json({ error: "Nothing to sell." }, { status: 400 });

  const d = await getLeagueData(slug);
  if (!d) return NextResponse.json({ error: "No league data yet." }, { status: 404 });
  const m = marketBook(d).markets.find((x) => x.key === market);
  const o = m?.outcomes.find((x) => x.id === outcome);
  if (!m || !o) return NextResponse.json({ error: "That market doesn't exist any more." }, { status: 404 });
  if (m.settled || o.state !== "open") return NextResponse.json({ error: "That market has closed." }, { status: 409 });

  const r = await placeTrade({ leagueId: v.leagueId, season: d.season.year, userId: v.userId, market, outcome, side, kind, model: o.p, dollars, qty });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 409 });
  return NextResponse.json(r);
}
