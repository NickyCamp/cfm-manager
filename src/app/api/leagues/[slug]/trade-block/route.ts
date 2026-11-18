// POST /api/leagues/<slug>/trade-block  { playerId, on: true|false, note? }
// Puts a player on (or takes him off) the trade block by hand. Same lock as nicknames: only the person
// running the player's team (the commissioner for CPU teams). Posts in Discord's #trade-block when set up.
import { NextResponse } from "next/server";
import { nicknameAccess } from "@/lib/cardArtStore";
import { getLeagueDataWithNicknames } from "@/lib/nicknameStore";
import { currentUser } from "@/lib/supabase/server";
import { discordOfUser } from "@/lib/tickets";
import { leagueBySlug } from "@/lib/discord/links";
import { setManualBlock } from "@/lib/discord/tradeBlock";

export const runtime = "nodejs";
type Ctx = { params: Promise<{ slug: string }> };

export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const body = (await req.json().catch(() => null)) as { playerId?: unknown; on?: unknown; note?: unknown } | null;
  const id = Number(body?.playerId);
  if (!body || !Number.isFinite(id) || id <= 0) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const [d, lg, user] = await Promise.all([getLeagueDataWithNicknames(slug).catch(() => null), leagueBySlug(slug), currentUser().catch(() => null)]);
  const p = d?.players.find((x) => x.id === id);
  if (!d || !lg || !p || p.gone || !p.team) return NextResponse.json({ error: "Player not found on a team." }, { status: 404 });
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const access = await nicknameAccess(slug, p.team);
  if (!access.canEdit) return NextResponse.json({ error: "Only the person running this player's team can put him on the trade block." }, { status: 403 });
  const disc = await discordOfUser(user.id).catch(() => null);
  const t = d.teams.find((x) => x.id === p.team);
  const who = disc ? `<@${disc.id}>` : `the ${t ? t.name : "team"}'s manager`;
  const r = await setManualBlock(lg, d, p, Boolean(body.on), { by: `user:${user.id}`, who, note: String(body.note ?? "") });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json({ ok: true, message: r.text.replace(/ Posted in <#\d+>\./, " Posted in #trade-block.") });
}
