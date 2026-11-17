// POST /api/leagues/<slug>/trade-proposal  { query: "a=NYJ&b=PIT&pa=..&pb=..&ka=..&kb=.." }
// The Trade Tool's "Submit to Discord" (Nick, 2026-11-17): posts the agreed trade in the league's
// #trade-proposals channel with the trade chart. Only the managers of the two teams (matched by
// their connected EA names, like card art) or a commissioner can submit.
import { NextResponse } from "next/server";
import { currentUser, supabaseAdmin } from "@/lib/supabase/server";
import { isCommissioner, teamsOfUser } from "@/lib/marketStore";
import { discordOfUser } from "@/lib/tickets";
import { postTradeProposal } from "@/lib/discord/tradeChannels";

export const runtime = "nodejs";
export const maxDuration = 60;
type Ctx = { params: Promise<{ slug: string }> };

export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const user = await currentUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Sign in to submit a trade." }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { query?: unknown } | null;
  const query = Object.fromEntries(new URLSearchParams(typeof body?.query === "string" ? body.query : ""));
  if (!query.a || !query.b) return NextResponse.json({ error: "Pick both teams first." }, { status: 400 });

  const { data: lg } = await supabaseAdmin().from("leagues").select("id").eq("slug", slug).maybeSingle();
  if (!lg) return NextResponse.json({ error: "League not found." }, { status: 404 });
  const [mine, commish] = await Promise.all([
    teamsOfUser(lg.id, user.id).catch(() => [] as string[]),
    isCommissioner(lg.id, user.id).catch(() => false),
  ]);
  const runs = mine.map((x) => x.toLowerCase());
  if (!commish && !runs.includes(query.a.toLowerCase()) && !runs.includes(query.b.toLowerCase())) {
    return NextResponse.json({ error: `Only the managers of ${query.a} or ${query.b} (or a commissioner) can submit this trade. Your team comes from the EA account you connected.` }, { status: 403 });
  }

  const discord = await discordOfUser(user.id).catch(() => null);
  const name = String((user.user_metadata as Record<string, unknown> | undefined)?.name || user.email?.split("@")[0] || "a league member");
  try {
    const message = await postTradeProposal(slug, query, { discordId: discord?.id, name });
    return NextResponse.json({ ok: true, message });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
