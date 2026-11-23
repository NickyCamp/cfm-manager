// GET /api/cron/game-channels — Vercel cron every 15 minutes (vercel.json). Deletes game channels 12 hours
// after their box score went up, and posts any box scores a sync's own call missed (src/lib/discord/gameFinals.ts).
// Once an hour it also asks EA about the current week (liveCheckCron in src/lib/eaLive.ts): records played vs simmed while EA
// still says it, and starts a sync when a game has been played.
import { NextResponse } from "next/server";
import { gameChannelsCron } from "@/lib/discord/gameFinals";
import { liveCheckCron } from "@/lib/eaLive";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const ok = secret
    ? req.headers.get("authorization") === `Bearer ${secret}`
    : (req.headers.get("user-agent") || "").startsWith("vercel-cron/");
  if (!ok) return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  const live = await liveCheckCron().catch((e) => ({ error: (e as Error).message }));
  return NextResponse.json({ leagues: await gameChannelsCron(), live });
}
