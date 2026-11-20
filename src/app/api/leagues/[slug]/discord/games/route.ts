import { NextResponse } from "next/server";
import { gameChannelFinals } from "@/lib/discord/gameFinals";
import { checkWorkerCall } from "@/lib/workerSig";

export const maxDuration = 300;

// The sync worker calls this after each pull: box scores in the game channels of games that went final
// (src/lib/discord/gameFinals.ts). Signed with EA_TOKEN_KEY (src/lib/workerSig.ts).
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!checkWorkerCall(slug, req.headers.get("x-cfm-ts"), req.headers.get("x-cfm-sig"))) return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  const result = await gameChannelFinals(slug);
  return NextResponse.json({ result });
}
