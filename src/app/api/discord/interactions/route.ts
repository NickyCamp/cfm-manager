// POST /api/discord/interactions — Discord sends every slash command here
// (the "Interactions Endpoint URL" in the Discord developer portal).
// Commands answer "thinking…" at once and fill in the reply a moment later,
// because Discord allows only 3 seconds for the first answer and the league
// data may need loading.
import { after, NextResponse } from "next/server";
import { editOriginal, followUpPrivate, verifyDiscordRequest, type Message } from "@/lib/discord/api";
import { autocomplete, myBets, runCommand, type Interaction } from "@/lib/discord/handlers";
import { loadAlertVideo } from "@/lib/discord/links";
import { anyPlayerModal, type BetReply, cancelFromButton, otherAmountModal, payoutFromButton, placeAnyPlayer, placeFromModal, placeQuick, quoteReply, type ComponentInteraction } from "@/lib/discord/marketButtons";
import { refreshForMarket } from "@/lib/discord/marketChannels";
import { leagueForGuild } from "@/lib/discord/links";
import { packChannelProblem } from "@/lib/discord/packChannels";
import { tradeVote } from "@/lib/discord/tradeChannels";
import { findPlayerModal, tradeBuilderTap } from "@/lib/discord/tradeBuilder";
import { helpAutocomplete, helpReply } from "@/lib/discord/help";

export const runtime = "nodejs";
export const maxDuration = 300; // /alertvideo copies a video of up to 10 MB; /marketchannels can post a whole week of bet lines

const PING = 1, COMMAND = 2, COMPONENT = 3, AUTOCOMPLETE = 4, MODAL_SUBMIT = 5;

export async function POST(req: Request) {
  const body = await req.text();
  const ok = verifyDiscordRequest(body, req.headers.get("x-signature-ed25519"), req.headers.get("x-signature-timestamp"), process.env.DISCORD_PUBLIC_KEY || "");
  if (!ok) return new NextResponse("Bad signature", { status: 401 });

  const i = JSON.parse(body) as Interaction;
  if (i.type === PING) return NextResponse.json({ type: 1 });

  // /help: static text, so it answers at once (no league lookup, no "thinking…").
  const helpOpt = (n: string) => i.data?.options?.find((o) => o.name === n);
  if (i.type === AUTOCOMPLETE && i.data?.name === "help") {
    return NextResponse.json({ type: 8, data: { choices: helpAutocomplete(String(helpOpt("command")?.value ?? "")) } });
  }
  if (i.type === COMMAND && i.data?.name === "help") {
    const { flags, content, embeds, allowed_mentions } = helpReply({ topic: helpOpt("topic")?.value as string | undefined, command: helpOpt("command")?.value as string | undefined });
    return NextResponse.json({ type: 4, data: { flags, content, embeds, allowed_mentions } });
  }

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
  // "🎟️ My bets": your open bets with Cancel / Cash out buttons (private)
  if (i.type === COMPONENT && tapId === "mkmy") {
    const base = new URL(req.url).origin;
    after(async () => {
      const msg = await myBets(i, base).catch((e) => { console.error("discord my bets failed", e); return { content: "Something went wrong. Try /bets." }; });
      await editOriginal(i.application_id, i.token, msg);
    });
    return NextResponse.json({ type: 5, data: { flags: 1 << 6 } });
  }
  if (i.type === COMPONENT && tapId.startsWith("mkq|")) {
    after(async () => {
      const res: string | BetReply = await placeQuick(i as ComponentInteraction).catch((e) => { console.error("discord quick bet failed", e); return "Something went wrong placing that bet. Try again in a minute."; });
      await editOriginal(i.application_id, i.token, typeof res === "string" ? { content: res, components: [] } : { content: res.content, components: res.components ?? [] });
    });
    return NextResponse.json({ type: 6 });
  }
  if (i.type === COMPONENT && tapId.startsWith("mko|")) return NextResponse.json(otherAmountModal(i as ComponentInteraction));
  const cid = String((i as ComponentInteraction).data?.custom_id || "");
  // #futures: a team/player picked from a menu opens the amount box; "Any other player…" asks for a name too
  if (i.type === COMPONENT && cid.startsWith("mkany|")) return NextResponse.json(anyPlayerModal(i as ComponentInteraction));
  if (i.type === MODAL_SUBMIT && cid.startsWith("mkp|")) {
    after(async () => {
      const res: string | BetReply = await placeAnyPlayer(i as ComponentInteraction).catch((e) => { console.error("discord any-player bet failed", e); return "Something went wrong placing that bet. Try again in a minute."; });
      await editOriginal(i.application_id, i.token, typeof res === "string" ? { content: res, components: [] } : { content: res.content, components: res.components ?? [] });
    });
    return NextResponse.json({ type: 5, data: { flags: 1 << 6 } });
  }
  // /bets "Cancel #n": cancels the whole position (private reply)
  if (i.type === COMPONENT && cid.startsWith("mkc|")) {
    // "Cancel this bet" on a bet confirmation (has a qty) replaces that confirmation; /bets buttons answer in a new private message
    const onConfirmation = cid.split("|").length >= 5;
    after(async () => {
      const text = await cancelFromButton(i as ComponentInteraction).catch((e) => { console.error("discord cancel failed", e); return "Something went wrong cancelling that. Try again in a minute."; });
      await editOriginal(i.application_id, i.token, onConfirmation ? { content: text, components: [] } : { content: text });
    });
    return NextResponse.json(onConfirmation ? { type: 6 } : { type: 5, data: { flags: 1 << 6 } });
  }

  // /trade builder (private message): "Find player" opens a name box at once; every other tap and the
  // name box answer "deferred update", then edit the builder.
  if (i.type === COMPONENT && cid === "tb|find") return NextResponse.json(findPlayerModal());
  if ((i.type === COMPONENT || i.type === MODAL_SUBMIT) && cid.startsWith("tb|")) {
    after(async () => {
      try {
        const r = await tradeBuilderTap(i as ComponentInteraction);
        if (r.message) await editOriginal(i.application_id, i.token, r.message);
        if (r.reply) await followUpPrivate(i.application_id, i.token, r.reply);
      } catch (e) {
        console.error("discord trade builder failed", e);
        await followUpPrivate(i.application_id, i.token, "Something went wrong with the trade builder. Try /trade again.");
      }
    });
    return NextResponse.json({ type: 6 });
  }
  // #trade-proposals: Approve / Reject (admins). Answer at once, then save the vote and edit the post.
  if (i.type === COMPONENT && cid.startsWith("tv|")) {
    after(async () => {
      try {
        const r = await tradeVote(i as ComponentInteraction);
        if (r.message) await editOriginal(i.application_id, i.token, r.message as Message);
        if (r.reply) await followUpPrivate(i.application_id, i.token, r.reply);
      } catch (e) {
        console.error("discord trade vote failed", e);
        await followUpPrivate(i.application_id, i.token, "Something went wrong saving your vote. Try again in a minute.");
      }
    });
    return NextResponse.json({ type: 6 });
  }
  // #previous-week-payouts: Applied / Undo (admins)
  if (i.type === COMPONENT && (cid.startsWith("mpa|") || cid.startsWith("mpu|"))) {
    // Answer at once and do the work after: the admin-role lookup and the save can take longer than the
    // 3 seconds Discord allows, which showed "This interaction failed" even though the save went through.
    after(async () => {
      try {
        const r = await payoutFromButton(i as ComponentInteraction);
        if (r.type === 7) await editOriginal(i.application_id, i.token, r.data as Message);
        else await followUpPrivate(i.application_id, i.token, String((r.data as { content?: string }).content || "Couldn't do that."));
      } catch (e) {
        console.error("discord payout button failed", e);
        await followUpPrivate(i.application_id, i.token, "Something went wrong saving that. Try again in a minute.");
      }
    });
    return NextResponse.json({ type: 6 });
  }
  if (i.type === MODAL_SUBMIT && String((i as ComponentInteraction).data?.custom_id || "").startsWith("mkb|")) {
    after(async () => {
      const res: string | BetReply = await placeFromModal(i as ComponentInteraction).catch((e) => { console.error("discord bet failed", e); return "Something went wrong placing that bet. Try again in a minute."; });
      await editOriginal(i.application_id, i.token, typeof res === "string" ? { content: res, components: [] } : { content: res.content, components: res.components ?? [] });
    });
    return NextResponse.json({ type: 5, data: { flags: 1 << 6 } });
  }

  if (i.type === COMMAND) {
    const base = new URL(req.url).origin;
    // /pack and /packs in the league's server: only inside the Packs category (/packchannels).
    // Checked before answering so the "go to #pack-opening" note is private and nothing posts here.
    // If the lookup is slow, let it through; runCommand checks again.
    const more = i.data?.name === "league" ? String(i.data.options?.find((o) => o.name === "more")?.value ?? "") : "";
    if (i.guild_id && (i.data?.name === "pack" || i.data?.name === "packs" || more === "pack" || more === "packs")) {
      const lg = await Promise.race([
        leagueForGuild(i.guild_id).catch(() => null),
        new Promise<null>((r) => setTimeout(() => r(null), 1500)),
      ]);
      const problem = packChannelProblem(lg, i.guild_id, i.channel);
      if (problem) return NextResponse.json({ type: 4, data: { content: problem, flags: 1 << 6 } });
    }
    // Settings changes reply only to the person who ran them; everything else is public.
    const quiet = ["link", "unlink", "notify", "myleague", "alertvideo", "removealertvideo", "connect", "marketchannels", "gamechannels", "tradechannels", "transactionchannels", "auditchannels", "packchannels", "trade", "balance", "bets", "payouts"].includes(i.data?.name || "")
      // /audit: the results post in the Audits category; the runner gets a private pointer to them
      || i.data?.name === "audit";
    after(async () => {
      try {
        const msg = await runCommand(i, base);
        // e.g. /cap showing a team under water plays the league's over-the-cap video.
        const file = msg.video ? await loadAlertVideo(msg.video).catch(() => undefined) : undefined;
        await editOriginal(i.application_id, i.token, msg, file);
        // e.g. /sync: wait for the run to finish, then update the same reply.
        const next = msg.followUp ? await msg.followUp().catch(() => null) : null;
        if (next) await editOriginal(i.application_id, i.token, next);
      } catch (e) {
        console.error("discord command failed", i.data?.name, e);
        await editOriginal(i.application_id, i.token, { content: "Something went wrong answering that. Try again in a minute." });
      }
    });
    return NextResponse.json({ type: 5, data: quiet ? { flags: 1 << 6 } : {} });
  }

  return NextResponse.json({ type: 4, data: { content: "Not supported.", flags: 1 << 6 } });
}
