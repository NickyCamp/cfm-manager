// Small helpers for Discord: request signature check, message shapes and REST calls.
import crypto from "node:crypto";

const API = "https://discord.com/api/v10";

/** Discord signs every interaction with Ed25519; reject anything that doesn't verify. */
export function verifyDiscordRequest(body: string, signature: string | null, timestamp: string | null, publicKeyHex: string): boolean {
  if (!signature || !timestamp || !publicKeyHex) return false;
  try {
    const key = crypto.createPublicKey({
      key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(publicKeyHex, "hex")]),
      format: "der",
      type: "spki",
    });
    return crypto.verify(null, Buffer.from(timestamp + body), key, Buffer.from(signature, "hex"));
  } catch {
    return false;
  }
}

export type Embed = {
  title?: string; url?: string; description?: string; color?: number;
  fields?: { name: string; value: string; inline?: boolean }[];
  thumbnail?: { url: string }; image?: { url: string }; footer?: { text: string }; author?: { name: string; url?: string };
};
export type Message = {
  content?: string; embeds?: Embed[]; flags?: number; allowed_mentions?: { parse: string[] };
  event?: AlertEvent;  // our tag: which kind of update post this is (alert videos)
  video?: AlertVideo;  // our tag: an alert video to attach to a command reply
};

/** League events a server can attach a video to (/alertvideo). */
export const ALERT_EVENTS = { overcap: "A team goes over the cap", trade: "A trade goes through", advance: "The league advances" } as const;
export type AlertEvent = keyof typeof ALERT_EVENTS;
export type AlertVideo = { path: string; filename: string; contentType: string; size: number; setAt?: string };
/** Discord's upload limit for bots in a server without boosts. */
export const MAX_VIDEO_BYTES = 10 * 1024 * 1024;

export const EPHEMERAL = 1 << 6;
export const BRAND = 0x0f3d2e; // field green

/** "#203731" → 0x203731 */
export const hexColor = (hex: string | undefined) => {
  const n = parseInt((hex || "").replace("#", ""), 16);
  return Number.isFinite(n) ? n : BRAND;
};

/** Trims text to Discord's limits so a long list never makes the whole message fail. */
export const clip = (s: string, max: number) => (s.length <= max ? s : s.slice(0, max - 1) + "…");

/** Keeps every embed within Discord's limits (fields ≤1024, description ≤4096, 25 fields). */
export function tidy(msg: Message): Message {
  const { event: _event, video: _video, ...m } = msg; // our own tags, not Discord's
  void _event; void _video;
  return {
    ...m,
    allowed_mentions: { parse: [] },
    content: m.content ? clip(m.content, 2000) : m.content,
    embeds: m.embeds?.slice(0, 10).map((e) => ({
      ...e,
      title: e.title ? clip(e.title, 256) : e.title,
      description: e.description ? clip(e.description, 4096) : e.description,
      fields: e.fields?.slice(0, 25).map((f) => ({ ...f, name: clip(f.name || "​", 256), value: clip(f.value || "​", 1024) })),
    })),
  };
}

type FileUpload = { data: Buffer; filename: string; contentType: string };

/** A JSON body, or multipart (payload_json + files[0]) when a file goes along. */
function messageBody(payload: object, file?: FileUpload): { body: BodyInit; headers: Record<string, string> } {
  if (!file) return { body: JSON.stringify(payload), headers: { "content-type": "application/json" } };
  const form = new FormData();
  form.append("payload_json", JSON.stringify({ ...payload, attachments: [{ id: 0, filename: file.filename }] }));
  form.append("files[0]", new Blob([new Uint8Array(file.data)], { type: file.contentType }), file.filename);
  return { body: form, headers: {} };
}

/** Replaces the "thinking…" reply of a deferred interaction with the real answer, optionally with a file. */
export async function editOriginal(appId: string, token: string, msg: Message, file?: FileUpload) {
  // The reply's visibility was fixed when it was deferred; edits can't change flags.
  const { body, headers } = messageBody({ ...tidy(msg), flags: undefined }, file);
  const res = await fetch(`${API}/webhooks/${appId}/${token}/messages/@original`, { method: "PATCH", headers, body });
  if (!res.ok) console.error("discord edit failed", res.status, await res.text().catch(() => ""));
}

/** Posts a message as the bot in a channel, optionally with a file (e.g. a video) attached.
 *  Needs DISCORD_BOT_TOKEN. Returns Discord's error text on failure. */
export async function postToChannel(botToken: string, channelId: string, msg: Message, file?: FileUpload): Promise<string | null> {
  const { body, headers } = messageBody(tidy(msg), file);
  const res = await fetch(`${API}/channels/${channelId}/messages`, { method: "POST", headers: { ...headers, authorization: `Bot ${botToken}` }, body });
  if (res.ok) return null;
  const text = await res.text().catch(() => "");
  if (res.status === 403) return "The bot can't post in that channel. Give the CFM Manager role View Channel and Send Messages there.";
  if (res.status === 404) return "That channel no longer exists, or the bot can't see it.";
  if (res.status === 413) return "The video is too big for Discord (10 MB limit for bots).";
  return `Discord said ${res.status}: ${text.slice(0, 200)}`;
}
