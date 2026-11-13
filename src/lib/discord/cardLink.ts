// Signed links to card images (one card, or a pack of cards), so only links the
// bot hands out work: cards can carry members-only art. Signed with a key derived from EA_TOKEN_KEY.
import { createHmac, timingSafeEqual } from "node:crypto";

const LINK_DAYS = 30; // Discord keeps its own copy once shown; this only has to outlast a slow first view.

function sig(slug: string, key: string, exp: number) {
  const k = process.env.EA_TOKEN_KEY?.trim();
  if (!k) throw new Error("EA_TOKEN_KEY is not set.");
  return createHmac("sha256", `discord-card:${k}`).update(`${slug}/${key}/${exp}`).digest("base64url").slice(0, 22);
}
const expiry = () => Math.floor(Date.now() / 1000) + LINK_DAYS * 86400;

/** side "both": front and back side by side. */
export function cardImageUrl(base: string, slug: string, id: number, side: "front" | "both" = "front") {
  const exp = expiry();
  return `${base}/api/discord/card?l=${encodeURIComponent(slug)}&p=${id}&e=${exp}&s=${sig(slug, String(id), exp)}${side === "both" ? "&side=both" : ""}`;
}

export function packImageUrl(base: string, slug: string, ids: number[]) {
  const exp = expiry(), key = ids.join("-");
  return `${base}/api/discord/pack?l=${encodeURIComponent(slug)}&p=${key}&e=${exp}&s=${sig(slug, key, exp)}`;
}

/** key: the player id, or the pack's ids joined with "-". */
export function checkCardLink(slug: string, key: string | number, exp: number, s: string) {
  if (!slug || !key || !exp || exp * 1000 < Date.now()) return false;
  const want = Buffer.from(sig(slug, String(key), exp)), got = Buffer.from(s || "");
  return want.length === got.length && timingSafeEqual(want, got);
}
