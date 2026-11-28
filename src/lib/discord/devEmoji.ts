// Dev trait icons on Discord (Nick, 2026-11-28): Normal bronze, Star silver, Superstar gold, X-Factor red X.
// The art lives in public/dev/*.png and is uploaded as the bot's own application emojis by
// scripts/discord/emojis.ts (run by the "Register Discord commands" workflow). Application emojis work
// anywhere the bot replies, including user installs, DMs and servers the bot isn't in.
// Before the emojis are uploaded (or if Discord can't be reached) everything falls back to the text label.
import { DEV_LABEL } from "../league/types";

export const DEV_EMOJI_NAMES = ["dev_normal", "dev_star", "dev_superstar", "dev_xfactor"] as const;
export const DEV_EMOJI_FILES = ["normal", "star", "superstar", "xfactor"] as const;

const API = "https://discord.com/api/v10";
const TTL = 6 * 60 * 60 * 1000;
let ids: (string | undefined)[] = [];
let loadedAt = 0;
let appIdCache: string | undefined;

/** Look up the bot's dev emojis (cached for 6 hours per server instance). Never throws. */
export async function loadDevEmojis(appId?: string): Promise<void> {
  if (Date.now() - loadedAt < TTL) return;
  const token = process.env.DISCORD_BOT_TOKEN?.trim();
  if (!token) return;
  const headers = { authorization: `Bot ${token}` };
  try {
    let app = appId || appIdCache;
    if (!app) {
      const me = await fetch(`${API}/applications/@me`, { headers, signal: AbortSignal.timeout(2500) });
      if (!me.ok) return;
      app = ((await me.json()) as { id: string }).id;
    }
    appIdCache = app;
    const res = await fetch(`${API}/applications/${app}/emojis`, { headers, signal: AbortSignal.timeout(2500) });
    if (!res.ok) return;
    const { items } = (await res.json()) as { items: { id: string; name: string }[] };
    ids = DEV_EMOJI_NAMES.map((n) => items.find((e) => e.name === n)?.id);
    loadedAt = Date.now();
  } catch {
    // Discord slow or down: keep text labels this time, try again next command.
  }
}

/** The dev icon as a Discord emoji, or "" before the emojis are uploaded. */
export function devIcon(dev: number | undefined): string {
  const k = dev ?? 0, id = ids[k];
  return id ? `<:${DEV_EMOJI_NAMES[k]}:${id}>` : "";
}

/** In a player list: just the icon (every dev, Normal included). Without icons: " · Star" style text,
 *  Normal left out, as before. `sep` goes in front of whatever is shown. */
export function devMark(dev: number | undefined, sep = " · "): string {
  const ic = devIcon(dev);
  if (ic) return `${sep}${ic}`;
  return dev ? `${sep}${DEV_LABEL[dev]}` : "";
}

/** Icon and name together ("<icon> Superstar"), for single-player views and dev changes. */
export function devName(dev: number | undefined): string {
  const ic = devIcon(dev);
  return `${ic ? `${ic} ` : ""}${DEV_LABEL[dev ?? 0]}`;
}
