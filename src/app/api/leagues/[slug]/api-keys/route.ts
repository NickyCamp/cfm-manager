// Commissioner-only: make, list and revoke agent API keys (lib/agent/keys.ts).
// GET → list; POST { name } → new key (shown once); POST { revoke: id } → revoke.
import { NextResponse } from "next/server";
import { currentUser, supabaseAdmin } from "@/lib/supabase/server";
import { isCommissioner } from "@/lib/marketStore";
import { createKey, listKeys, revokeKey } from "@/lib/agent/keys";

export const runtime = "nodejs";
type Ctx = { params: Promise<{ slug: string }> };

async function gate(slug: string) {
  const user = await currentUser().catch(() => null);
  if (!user) return { error: NextResponse.json({ error: "Sign in first." }, { status: 401 }) };
  const { data: lg } = await supabaseAdmin().from("leagues").select("id, slug").eq("slug", slug).maybeSingle();
  if (!lg) return { error: NextResponse.json({ error: "League not found." }, { status: 404 }) };
  if (!(await isCommissioner(lg.id, user.id).catch(() => false))) return { error: NextResponse.json({ error: "Only a commissioner can manage API keys." }, { status: 403 }) };
  return { user, lg };
}

export async function GET(_req: Request, ctx: Ctx) {
  const g = await gate((await ctx.params).slug);
  if ("error" in g) return g.error;
  return NextResponse.json({ keys: await listKeys(g.lg.id) });
}

export async function POST(req: Request, ctx: Ctx) {
  const g = await gate((await ctx.params).slug);
  if ("error" in g) return g.error;
  const body = (await req.json().catch(() => ({}))) as { name?: unknown; revoke?: unknown };
  if (typeof body.revoke === "string") {
    const r = await revokeKey(g.lg.id, body.revoke);
    return r.ok ? NextResponse.json({ ok: true, keys: await listKeys(g.lg.id) }) : NextResponse.json({ error: r.error }, { status: 500 });
  }
  const r = await createKey(g.lg.id, g.lg.slug, typeof body.name === "string" ? body.name : "", g.user.id);
  return r.ok ? NextResponse.json({ ok: true, key: r.key, keys: await listKeys(g.lg.id) }) : NextResponse.json({ error: r.error }, { status: 400 });
}
