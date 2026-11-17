// POST /api/leagues/<slug>/trade-picks  { key, picks: { [teamId]: ["2028 1st round pick", …] } }
// EA's export has no draft picks, so a trade the sync found shows only the players who moved
// (Nick, 2026-11-17: the DET ⇄ LAR McDuffie trade showed LAR getting nothing). A commissioner adds
// what each team got in picks; it's kept in leagues.settings.tradePicks, shown on the Transactions tab
// and in history posts, and the bot posts a note in the Discord #trades channel.
import { NextResponse } from "next/server";
import { currentUser, supabaseAdmin } from "@/lib/supabase/server";
import { isCommissioner } from "@/lib/marketStore";
import { updateLeagueSettings } from "@/lib/leagueSettings";
import { getLeagueData, getLeagueHistory } from "@/lib/league/load";
import { tradeKey, type TradePicks } from "@/lib/league/history";
import { dc } from "@/lib/discord/rest";
import type { TxChannelsState } from "@/lib/discord/txPosts";

export const runtime = "nodejs";
type Ctx = { params: Promise<{ slug: string }> };

export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const user = await currentUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { data: lg } = await supabaseAdmin().from("leagues").select("id, settings").eq("slug", slug).maybeSingle();
  if (!lg) return NextResponse.json({ error: "League not found." }, { status: 404 });
  if (!(await isCommissioner(lg.id, user.id).catch(() => false))) return NextResponse.json({ error: "Only a commissioner can add picks to a trade." }, { status: 403 });

  const body = (await req.json().catch(() => null)) as { key?: unknown; picks?: unknown } | null;
  const key = typeof body?.key === "string" ? body.key : "";
  const [hist, d] = await Promise.all([getLeagueHistory(slug), getLeagueData(slug)]);
  const trade = (hist?.events || []).filter((e) => e.kind === "trade" && !e.deal && tradeKey(e) === key);
  if (!trade.length) return NextResponse.json({ error: "That trade isn't in the transaction log." }, { status: 404 });
  const teamIds = [...new Set(trade.flatMap((e) => [e.from || 0, e.to || 0]))].filter(Boolean).map(String);

  const raw = (body?.picks && typeof body.picks === "object" ? body.picks : {}) as Record<string, unknown>;
  const picks: Record<string, string[]> = {};
  for (const t of teamIds) {
    const list = Array.isArray(raw[t]) ? (raw[t] as unknown[]) : [];
    const clean = list.filter((x): x is string => typeof x === "string").map((x) => x.trim().slice(0, 60)).filter(Boolean).slice(0, 10);
    if (clean.length) picks[t] = clean;
  }

  const r = await updateLeagueSettings(lg.id, (s) => {
    const all = { ...((s.tradePicks as TradePicks | undefined) || {}) };
    if (Object.keys(picks).length) all[key] = picks; else delete all[key];
    s.tradePicks = all;
    return s;
  });
  if (!r.ok) return NextResponse.json({ error: r.error || "Couldn't save." }, { status: 500 });

  // A note in the Discord #trades channel, so the history post there gets its picks.
  const ch = (lg.settings as { txChannels?: TxChannelsState } | null)?.txChannels?.channels?.trades;
  if (ch && Object.keys(picks).length && process.env.DISCORD_BOT_TOKEN) {
    const abbr = (id: string) => d?.teams.find((t) => String(t.id) === id)?.abbr || "?";
    const wk = trade[0].wk;
    const players = (id: string) => trade.filter((e) => String(e.to) === id).map((e) => `${e.pos} ${e.name}`);
    const lines = teamIds.map((t) => `**${abbr(t)} got:** ${[...players(t), ...(picks[t] || [])].join(", ") || "nothing listed"}`);
    await dc("POST", `/channels/${ch}/messages`, {
      allowed_mentions: { parse: [] },
      embeds: [{ title: `📝 Picks added: ${teamIds.map(abbr).join(" ⇄ ")} (${wk.year} ${wk.title})`, description: lines.join("\n"), color: 0x0f3d2e, footer: { text: "Added by a commissioner; EA's data doesn't list draft picks." } }],
    }).catch(() => null);
  }
  return NextResponse.json({ ok: true, picks });
}
