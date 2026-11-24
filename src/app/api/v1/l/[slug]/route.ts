// GET /api/v1/l/<slug>: what the REST side of the agent API offers (the same tools as MCP).
import { NextResponse } from "next/server";
import { TOOLS, inputSchema } from "@/lib/agent/tools";
import { checkKey, keyFromRequest } from "@/lib/agent/keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ slug: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const key = await checkKey(keyFromRequest(req));
  if (!key.ok) return NextResponse.json({ error: key.error }, { status: key.status });
  if (key.slug !== slug) return NextResponse.json({ error: `This key is for "${key.slug}", not "${slug}".` }, { status: 403 });
  const base = new URL(req.url).origin + `/api/v1/l/${slug}`;
  return NextResponse.json({
    league: key.leagueName,
    auth: "Send the key as 'Authorization: Bearer <key>' (or ?key=<key>).",
    endpoints: TOOLS.map((t) => ({ url: `${base}/${t.name}`, title: t.title, description: t.description, params: inputSchema(t).properties })),
    mcp: `${new URL(req.url).origin}/api/mcp`,
  });
}
