// POST /api/discord/interactions — Discord sends every slash command here
// (the "Interactions Endpoint URL" in the Discord developer portal).
// Commands answer "thinking…" at once and fill in the reply a moment later,
// because Discord allows only 3 seconds for the first answer and the league
// data may need loading.
import { after, NextResponse } from "next/server";
import { editOriginal, verifyDiscordRequest } from "@/lib/discord/api";
import { autocomplete, runCommand, type Interaction } from "@/lib/discord/handlers";

export const runtime = "nodejs";
export const maxDuration = 30;

const PING = 1, COMMAND = 2, AUTOCOMPLETE = 4;

export async function POST(req: Request) {
  const body = await req.text();
  const ok = verifyDiscordRequest(body, req.headers.get("x-signature-ed25519"), req.headers.get("x-signature-timestamp"), process.env.DISCORD_PUBLIC_KEY || "");
  if (!ok) return new NextResponse("Bad signature", { status: 401 });

  const i = JSON.parse(body) as Interaction;
  if (i.type === PING) return NextResponse.json({ type: 1 });

  if (i.type === AUTOCOMPLETE) {
    // Must answer within 3 seconds and can't be deferred; give up quietly if the data is slow.
    const choices = await Promise.race([
      autocomplete(i).catch(() => []),
      new Promise<{ name: string; value: string }[]>((r) => setTimeout(() => r([]), 2500)),
    ]);
    return NextResponse.json({ type: 8, data: { choices } });
  }

  if (i.type === COMMAND) {
    const base = new URL(req.url).origin;
    // Settings changes reply only to the person who ran them; everything else is public.
    const quiet = ["link", "unlink", "notify", "myleague"].includes(i.data?.name || "");
    after(async () => {
      try {
        await editOriginal(i.application_id, i.token, await runCommand(i, base));
      } catch (e) {
        console.error("discord command failed", i.data?.name, e);
        await editOriginal(i.application_id, i.token, { content: "Something went wrong answering that. Try again in a minute." });
      }
    });
    return NextResponse.json({ type: 5, data: quiet ? { flags: 1 << 6 } : {} });
  }

  return NextResponse.json({ type: 4, data: { content: "Not supported.", flags: 1 << 6 } });
}
