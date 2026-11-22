// PUT /api/leagues/<slug>/stream/<teamId>  { url: "https://twitch.tv/name" }  ("" removes it)
// The person running the team, or a league commissioner / Madden admin.
import { NextResponse } from "next/server";
import { saveStreamLink } from "@/lib/streamStore";
import { streamUrl } from "@/lib/streams";

export const runtime = "nodejs";
type Ctx = { params: Promise<{ slug: string; teamId: string }> };

export async function PUT(req: Request, ctx: Ctx) {
  const { slug, teamId } = await ctx.params;
  const id = Number(teamId);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Bad team id." }, { status: 400 });
  const body = (await req.json().catch(() => null)) as { url?: unknown } | null;
  if (!body) return NextResponse.json({ error: "Nothing was sent." }, { status: 400 });
  const r = await saveStreamLink(slug, id, String(body.url ?? "").slice(0, 300));
  if (r.error) return NextResponse.json({ error: r.error }, { status: r.status || 400 });
  return NextResponse.json({ ok: true, url: r.link ? streamUrl(r.link) : "" });
}
