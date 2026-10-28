// GET /api/cron/sync — daily Vercel cron (vercel.json). Backstop so every
// league is checked at least once a day even if nobody visits it and GitHub's
// own schedule skips. "auto" only pulls from EA for leagues that moved.
import { NextResponse } from "next/server";
import { triggerSync } from "@/lib/dispatch";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const ok = secret
    ? req.headers.get("authorization") === `Bearer ${secret}`
    : (req.headers.get("user-agent") || "").startsWith("vercel-cron/");
  if (!ok) return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  const started = await triggerSync("", "auto");
  return NextResponse.json({ started });
}
