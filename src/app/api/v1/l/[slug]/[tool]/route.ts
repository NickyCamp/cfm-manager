// GET /api/v1/l/<slug>/<tool>?arg=value: one agent-API tool as plain JSON (lib/agent/tools.ts).
import { NextResponse } from "next/server";
import { ToolError, argsFromQuery, runTool, toolByName } from "@/lib/agent/tools";
import { checkKey, keyFromRequest, overLimit } from "@/lib/agent/keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
type Ctx = { params: Promise<{ slug: string; tool: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { slug, tool } = await ctx.params;
  const key = await checkKey(keyFromRequest(req));
  if (!key.ok) return NextResponse.json({ error: key.error }, { status: key.status });
  if (key.slug !== slug) return NextResponse.json({ error: `This key is for "${key.slug}", not "${slug}".` }, { status: 403 });
  if (overLimit(key.keyId)) return NextResponse.json({ error: "Too many calls; slow down (limit 120 per minute)." }, { status: 429, headers: { "retry-after": "30" } });
  const t = toolByName(tool.replace(/-/g, "_"));
  if (!t) return NextResponse.json({ error: `Unknown endpoint "${tool}". See /api/v1/l/${slug} for the list.` }, { status: 404 });
  try {
    return NextResponse.json(await runTool(slug, t.name, argsFromQuery(t, new URL(req.url).searchParams)), { headers: { "access-control-allow-origin": "*" } });
  } catch (e) {
    if (e instanceof ToolError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error("agent api failed", slug, tool, e);
    return NextResponse.json({ error: "Server error; try again in a minute." }, { status: 500 });
  }
}
