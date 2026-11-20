// PUT /api/leagues/<slug>/teams/<teamId>/showcase  { ids: [playerId, ...] }  (or { reset: true })
// The 5 cards in the team page's showcase stack. Same rule as card art: the team's manager
// (matched by EA name) or the league commissioner.
import { NextResponse } from "next/server";
import { cardArtAccess } from "@/lib/cardArtStore";
import { saveTeamShowcase, SHOWCASE_SIZE } from "@/lib/showcaseStore";
import { getLeagueData } from "@/lib/league/load";

export const runtime = "nodejs";
type Ctx = { params: Promise<{ slug: string; teamId: string }> };

export async function PUT(req: Request, ctx: Ctx) {
  const { slug, teamId } = await ctx.params;
  const tid = Number(teamId);
  const d = await getLeagueData(slug).catch(() => null);
  const team = d?.teams.find((t) => t.id === tid);
  if (!d || !team) return NextResponse.json({ error: "Team not found." }, { status: 404 });
  const access = await cardArtAccess(slug, tid);
  if (!access.canEdit) return NextResponse.json({ error: access.why?.replace("change card art for players on", "change the showcase for") || "Sign in to change the showcase." }, { status: 403 });
  const body = (await req.json().catch(() => null)) as { ids?: unknown; reset?: boolean } | null;
  if (!body) return NextResponse.json({ error: "Nothing was sent." }, { status: 400 });
  let ids: number[] = [];
  if (!body.reset) {
    if (!Array.isArray(body.ids)) return NextResponse.json({ error: "Pick some cards first." }, { status: 400 });
    const onTeam = new Set(d.players.filter((p) => p.team === tid && !p.gone && !p.ps).map((p) => p.id));
    ids = [...new Set(body.ids.map(Number))].filter((id) => onTeam.has(id));
    if (ids.length > SHOWCASE_SIZE) return NextResponse.json({ error: `Pick up to ${SHOWCASE_SIZE} cards.` }, { status: 400 });
    if (!ids.length) return NextResponse.json({ error: "Those players aren't on this roster." }, { status: 400 });
  }
  try {
    await saveTeamShowcase(slug, tid, ids);
  } catch (e) {
    console.error("save showcase", slug, tid, e);
    return NextResponse.json({ error: "Couldn't save the showcase. Try again." }, { status: 502 });
  }
  return NextResponse.json({ ok: true, ids });
}
