import { NextResponse } from "next/server";
import { getLeagueData } from "@/lib/league/load";
import { closeTimes, fmtET, isCommissioner, kickoffPermission, marketsShared, memberNames, setCloseTime, teamOfUser, viewer } from "@/lib/marketStore";
import { kickoffProblem } from "@/lib/kickoff";
import { refreshGame } from "@/lib/discord/marketChannels";
import { after } from "next/server";

// POST { gameId, closeAt: ISO time | "now" } — set when a game's markets close (its kickoff).
// The two teams' managers or a commissioner; once it has passed, only a commissioner.
// Every change is kept and shown publicly with who made it.
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!(await marketsShared())) return NextResponse.json({ error: "Shared trading isn't set up yet." }, { status: 503 });
  const v = await viewer(slug);
  if (!v.userId) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!v.member || !v.leagueId) return NextResponse.json({ error: "Only members of this league can set kickoff times." }, { status: 403 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const d = await getLeagueData(slug);
  if (!d) return NextResponse.json({ error: "No league data yet." }, { status: 404 });
  const g = d.games.find((x) => x.id === Number(body?.gameId));
  const check = kickoffProblem(d, g);
  if (check) return NextResponse.json({ error: check }, { status: 409 });
  const teams = new Map(d.teams.map((t) => [t.id, t.abbr]));
  const [admin, userTeam, current] = await Promise.all([isCommissioner(v.leagueId, v.userId), teamOfUser(v.leagueId, v.userId), closeTimes(v.leagueId, d.season.year).then((m) => m.get(g!.id))]);
  const denied = kickoffPermission({ admin, userTeam, homeAbbr: teams.get(g!.home) || "", awayAbbr: teams.get(g!.away) || "", current });
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });
  const when = parseWhenIso(body?.closeAt);
  if (!when) return NextResponse.json({ error: "Pick a time between now and two weeks from now." }, { status: 400 });
  const name = (await memberNames([v.userId])).get(v.userId) || "Member";
  await setCloseTime(v.leagueId, d.season.year, g!.id, when, { kind: "site", id: v.userId, name });
  after(() => refreshGame(slug, g!.id).catch(() => {}));
  return NextResponse.json({ ok: true, closeAt: when.toISOString(), text: `Betting closes ${fmtET(when)}.` });
}

function parseWhenIso(raw: unknown): Date | null {
  const now = Date.now();
  const t = raw === "now" ? now : Date.parse(String(raw ?? ""));
  if (!Number.isFinite(t) || t < now - 60_000 || t > now + 14 * 86400_000) return null;
  return new Date(Math.max(t, now));
}
