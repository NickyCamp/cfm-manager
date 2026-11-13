// PUT /api/leagues/<slug>/nickname/<playerId>  { nickname: "Showtime" }  ("" removes it)
// Only the person running the player's team (commissioner for CPU teams / free agents).
import { NextResponse } from "next/server";
import { nicknameAccess } from "@/lib/cardArtStore";
import { cleanNickname, saveNickname } from "@/lib/nicknameStore";
import { getLeagueData } from "@/lib/league/load";

export const runtime = "nodejs";
type Ctx = { params: Promise<{ slug: string; playerId: string }> };

export async function PUT(req: Request, ctx: Ctx) {
  const { slug, playerId } = await ctx.params;
  const id = Number(playerId);
  if (!Number.isFinite(id) || id <= 0) return NextResponse.json({ error: "Bad player id." }, { status: 400 });
  const p = (await getLeagueData(slug).catch(() => null))?.players.find((x) => x.id === id);
  if (!p || p.gone) return NextResponse.json({ error: "Player not found." }, { status: 404 });
  const access = await nicknameAccess(slug, p.team || undefined);
  if (!access.canEdit) return NextResponse.json({ error: access.why || "Sign in to set a nickname." }, { status: 403 });
  const body = (await req.json().catch(() => null)) as { nickname?: unknown } | null;
  if (!body) return NextResponse.json({ error: "Nothing was sent." }, { status: 400 });
  const nick = cleanNickname(body.nickname);
  try {
    await saveNickname(slug, id, nick);
  } catch (e) {
    console.error("save nickname", slug, id, e);
    return NextResponse.json({ error: "Couldn't save the nickname. Try again." }, { status: 502 });
  }
  return NextResponse.json({ ok: true, nickname: nick });
}
