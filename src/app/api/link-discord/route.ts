import { NextResponse } from "next/server";
import { currentUser } from "@/lib/supabase/server";
import { linkDiscord, readLinkToken } from "@/lib/tickets";

// Form POST from /link-discord: ties the signed-in user to the Discord account in the token.
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const t = String(form?.get("t") || "");
  const tok = readLinkToken(t);
  const back = new URL(`/link-discord?t=${encodeURIComponent(t)}`, req.url);
  if (!tok) return NextResponse.redirect(back, 303);
  const user = await currentUser().catch(() => null);
  if (!user) return NextResponse.redirect(back, 303);
  await linkDiscord(user.id, tok.discordId, tok.name);
  return NextResponse.redirect(new URL("/link-discord?done=1", req.url), 303);
}
