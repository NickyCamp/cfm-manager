// POST /api/discord/interactions — Discord sends every slash command here
// (the "Interactions Endpoint URL" in the Discord developer portal).
// Commands answer "thinking…" at once and fill in the reply a moment later,
// because Discord allows only 3 seconds for the first answer and the league
// data may need loading.
import { after, NextResponse } from "next/server";
import { editOriginal, verifyDiscordRequest } from "@/lib/discord/api";
import { autocomplete, runCommand, type Interaction } from "@/lib/discord/handlers";
import { loadAlertVideo } from "@/lib/discord/links";
import { anyPlayerModal, cancelFromButton, otherAmountModal, payoutFromButton, placeAnyPlayer, placeFromModal, placeQuick, quoteReply, type ComponentInteraction } from "@/lib/discord/marketButtons";
import { refreshForMarket } from "@/lib/discord/marketChannels";
import { leagueForGuild } from "@/lib/discord/links";

export const runtime = "nodejs";
export const maxDuration = 300; // /alertvideo copies a video of up to 10 MB; /marketchannels can post a whole week of bet lines

const PING = 1, COMMAND = 2, COMPONENT = 3, AUTOCOMPLETE = 4, MODAL_SUBMIT = 5;

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

  // Markets channels: a Yes/No button opens the amount box; submitting it places the bet (private reply).
  // A bet button or a #futures pick: answer privately with the live price and quick amounts, then
  // refresh the message that was tapped (channel messages can lag a bet or two behind the site).
  const tapId = String((i as ComponentInteraction).data?.custom_id || "");
  if (i.type === COMPONENT && (tapId.startsWith("mk|") || tapId.startsWith("mksel|"))) {
    after(async () => {
      const q = await quoteReply(i as ComponentInteraction).catch((e) => { console.error("discord quote failed", e); return { content: "Something went wrong getting the price. Try again in a minute." } as { content: string; components?: unknown[] }; });
      await editOriginal(i.application_id, i.token, { content: q.content, components: q.components ?? [] });
      const lg = i.guild_id ? await leagueForGuild(i.guild_id).catch(() => null) : null;
      if (lg) await refreshForMarket(lg.slug, tapId.split("|")[1]).catch((e) => console.error("discord refresh failed", e));
    });
    return NextResponse.json({ type: 5, data: { flags: 1 << 6 } });
  }
  // the quote's quick-amount buttons place the bet; "Other amount…" opens the amount box
  if (i.type === COMPONENT && tapId.startsWith("mkq|")) {
    after(async () => {
      const text = await placeQuick(i as ComponentInteraction).catch((e) => { console.error("discord quick bet failed", e); return "Something went wrong placing that bet. Try again in a minute."; });
      await editOriginal(i.application_id, i.token, { content: text, components: [] });
    });
    return NextResponse.json({ type: 6 });
  }
  if (i.type === COMPONENT && tapId.startsWith("mko|")) return NextResponse.json(otherAmountModal(i as ComponentInteraction));
  const cid = String((i as ComponentInteraction).data?.custom_id || "");
  // #futures: a team/player picked from a menu opens the amount box; "Any other player…" asks for a name too
  if (i.type === COMPONENT && cid.startsWith("mkany|")) return NextResponse.json(anyPlayerModal(i as ComponentInteraction));
  if (i.type === MODAL_SUBMIT && cid.startsWith("mkp|")) {
    after(async () => {
      const text = await placeAnyPlayer(i as ComponentInteraction).catch((e) => { console.error("discord any-player bet failed", e); return "Something went wrong placing that bet. Try again in a minute."; });
      await editOriginal(i.application_id, i.token, { content: text });
    });
    return NextResponse.json({ type: 5, data: { flags: 1 << 6 } });
  }
  // /bets "Cancel #n": cancels the whole position (private reply)
  if (i.type === COMPONENT && cid.startsWith("mkc|")) {
    after(async () => {
      const text = await cancelFromButton(i as ComponentInteraction).catch((e) => { console.error("discord cancel failed", e); return "Something went wrong cancelling that. Try again in a minute."; });
      await editOriginal(i.application_id, i.token, { content: text });
    });
    return NextResponse.json({ type: 5, data: { flags: 1 << 6 } });
  }
  // #previous-week-payouts: Applied / Undo (admins)
  if (i.type === COMPONENT && (cid.startsWith("mpa|") || cid.startsWith("mpu|"))) {
    return NextResponse.json(await payoutFromButton(i as ComponentInteraction));
  }
  if (i.type === MODAL_SUBMIT && String((i as ComponentInteraction).data?.custom_id || "").startsWith("mkb|")) {
    after(async () => {
      const text = await placeFromModal(i as ComponentInteraction).catch((e) => { console.error("discord bet failed", e); return "Something went wrong placing that bet. Try again in a minute."; });
      await editOriginal(i.application_id, i.token, { content: text });
    });
    return NextResponse.json({ type: 5, data: { flags: 1 << 6 } });
  }

  if (i.type === COMMAND) {
    const base = new URL(req.url).origin;
    // Settings changes reply only to the person who ran them; everything else is public.
    const quiet = ["link", "unlink", "notify", "myleague", "alertvideo", "removealertvideo", "connect", "marketchannels", "gamechannels", "balance", "bets", "payouts"].includes(i.data?.name || "");
    after(async () => {
      try {
        const msg = await runCommand(i, base);
        // e.g. /cap showing a team under water plays the league's over-the-cap video.
        const file = msg.video ? await loadAlertVideo(msg.video).catch(() => undefined) : undefined;
        await editOriginal(i.application_id, i.token, msg, file);
      } catch (e) {
        console.error("discord command failed", i.data?.name, e);
        await editOriginal(i.application_id, i.token, { content: "Something went wrong answering that. Try again in a minute." });
      }
    });
    return NextResponse.json({ type: 5, data: quiet ? { flags: 1 << 6 } : {} });
  }

  return NextResponse.json({ type: 4, data: { content: "Not supported.", flags: 1 << 6 } });
}
