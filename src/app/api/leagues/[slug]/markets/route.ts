import { NextResponse } from "next/server";
import { marketsShared, marketsStatus, viewer } from "@/lib/marketStore";
import { executeTrade } from "@/lib/marketTrade";

export const maxDuration = 30;

// GET: is shared trading on, and if not, why (no secrets). For checking setup.
export async function GET() {
  return NextResponse.json(await marketsStatus(), { headers: { "cache-control": "no-store" } });
}

// POST { market, outcome, side: "yes"|"no", kind: "buy"|"sell", amount?, qty? }
// amount is dollars (play money) or Tickets. League members only; prices are worked out here.
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!(await marketsShared())) return NextResponse.json({ error: "Shared trading isn't set up yet." }, { status: 503 });
  const v = await viewer(slug);
  if (!v.userId) return NextResponse.json({ error: "Sign in to trade." }, { status: 401 });
  if (!v.member || !v.leagueId) return NextResponse.json({ error: "Only members of this league can trade." }, { status: 403 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const side = body?.side === "no" ? "no" : body?.side === "yes" ? "yes" : null;
  const kind = body?.kind === "sell" ? "sell" : body?.kind === "buy" ? "buy" : null;
  if (!side || !kind) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const r = await executeTrade({
    slug, leagueId: v.leagueId, userId: v.userId, market: String(body?.market ?? ""), outcome: String(body?.outcome ?? ""),
    side, kind, amount: Number(body?.amount ?? body?.dollars), qty: Number(body?.qty),
  });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(r);
}
