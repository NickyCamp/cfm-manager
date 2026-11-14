import { NextResponse } from "next/server";
import { syncMarketChannels } from "@/lib/discord/marketChannels";
import { checkWorkerCall } from "@/lib/workerSig";

export const maxDuration = 60;

// The sync worker calls this after each pull: roll the Discord Markets channels on an
// advance and refresh every odds message. Signed with EA_TOKEN_KEY (src/lib/workerSig.ts).
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!checkWorkerCall(slug, req.headers.get("x-cfm-ts"), req.headers.get("x-cfm-sig"))) return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  const result = await syncMarketChannels(slug).catch((e) => `Failed: ${(e as Error).message}`);
  return NextResponse.json({ result });
}
