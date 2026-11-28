// Signed links to card images (one card, or a pack of cards), so only links the
// bot hands out work: cards can carry members-only art. Signed with a key derived from EA_TOKEN_KEY.
import { createHmac, timingSafeEqual } from "node:crypto";

const LINK_DAYS = 30; // Discord keeps its own copy once shown; this only has to outlast a slow first view.

function sig(slug: string, key: string, exp: number) {
  const k = process.env.EA_TOKEN_KEY?.trim();
  if (!k) throw new Error("EA_TOKEN_KEY is not set.");
  return createHmac("sha256", `discord-card:${k}`).update(`${slug}/${key}/${exp}`).digest("base64url").slice(0, 22);
}
// Links stay the same all day (2026-11-24) so a repeat of the same command gets the picture Vercel
// already drew (the image routes send s-maxage) instead of drawing it again. `v` is the data's
// version (pulledAt, plus anything else shown, like a nickname): a sync or edit gives a new link.
const DAY = 86400;
const expiry = () => (Math.floor(Date.now() / 1000 / DAY) + LINK_DAYS) * DAY;
// LINK_GEN: bump to give every picture a new link, e.g. after links Discord gave up on (2026-11-28,
// blank EML cards: Discord keeps showing a link blank once it timed out on it).
const LINK_GEN = "2";
const ver = (v?: string) => (v ? `&v=${createHmac("sha1", "v").update(`${LINK_GEN}|${v}`).digest("base64url").slice(0, 10)}` : "");

/** side "both": front and back side by side. */
export function cardImageUrl(base: string, slug: string, id: number, side: "front" | "both" = "front", v?: string) {
  const exp = expiry();
  return `${base}/api/discord/card?l=${encodeURIComponent(slug)}&p=${id}&e=${exp}&s=${sig(slug, String(id), exp)}${side === "both" ? "&side=both" : ""}${ver(v)}`;
}

export function packImageUrl(base: string, slug: string, ids: number[], v?: string) {
  const exp = expiry(), key = ids.join("-");
  return `${base}/api/discord/pack?l=${encodeURIComponent(slug)}&p=${key}&e=${exp}&s=${sig(slug, key, exp)}${ver(v)}`;
}

/** The /tws matchup or box-score picture for one game. */
export function matchupImageUrl(base: string, slug: string, gameId: number, v?: string) {
  const exp = expiry(), key = `g${gameId}`;
  return `${base}/api/discord/matchup?l=${encodeURIComponent(slug)}&g=${gameId}&e=${exp}&s=${sig(slug, key, exp)}${ver(v)}`;
}

/** The /stats chart: a category, league-wide or one team. */
export function statsImageUrl(base: string, slug: string, cat: string, teamId?: number, byTeam = false, v?: string) {
  const exp = expiry(), key = `s${cat}-${teamId ?? ""}${byTeam ? "-T" : ""}`;
  return `${base}/api/discord/stats?l=${encodeURIComponent(slug)}&c=${cat}${teamId != null ? `&t=${teamId}` : ""}${byTeam ? "&b=t" : ""}&e=${exp}&s=${sig(slug, key, exp)}${ver(v)}`;
}

/** key: the player id, or the pack's ids joined with "-". */
export function checkCardLink(slug: string, key: string | number, exp: number, s: string) {
  if (!slug || !key || !exp || exp * 1000 < Date.now()) return false;
  const want = Buffer.from(sig(slug, String(key), exp)), got = Buffer.from(s || "");
  return want.length === got.length && timingSafeEqual(want, got);
}

/** The /amnesty picture for one player. */
export function amnestyImageUrl(base: string, slug: string, playerId: number, v?: string) {
  const exp = expiry(), key = `a${playerId}`;
  return `${base}/api/discord/amnesty?l=${encodeURIComponent(slug)}&p=${playerId}&e=${exp}&s=${sig(slug, key, exp)}${ver(v)}`;
}

/** The /gamelog (season key "2027" / "nfl-2025") or /yearlog ("career") picture for one player. */
export function logImageUrl(base: string, slug: string, playerId: number, season: string, v?: string) {
  const exp = expiry(), key = `log${playerId}-${season}`;
  return `${base}/api/discord/log?l=${encodeURIComponent(slug)}&p=${playerId}&y=${encodeURIComponent(season)}&e=${exp}&s=${sig(slug, key, exp)}${ver(v)}`;
}
