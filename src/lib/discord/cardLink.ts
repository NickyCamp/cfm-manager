// Signed links to a player's card image, so only links the bot hands out work
// (the card can carry members-only art). Signed with a key derived from EA_TOKEN_KEY.
import { createHmac, timingSafeEqual } from "node:crypto";

const LINK_DAYS = 30; // Discord keeps its own copy once shown; this only has to outlast a slow first view.

function sig(slug: string, id: number, exp: number) {
  const k = process.env.EA_TOKEN_KEY?.trim();
  if (!k) throw new Error("EA_TOKEN_KEY is not set.");
  return createHmac("sha256", `discord-card:${k}`).update(`${slug}/${id}/${exp}`).digest("base64url").slice(0, 22);
}

export function cardImageUrl(base: string, slug: string, id: number) {
  const exp = Math.floor(Date.now() / 1000) + LINK_DAYS * 86400;
  return `${base}/api/discord/card?l=${encodeURIComponent(slug)}&p=${id}&e=${exp}&s=${sig(slug, id, exp)}`;
}

export function checkCardLink(slug: string, id: number, exp: number, s: string) {
  if (!slug || !id || !exp || exp * 1000 < Date.now()) return false;
  const want = Buffer.from(sig(slug, id, exp)), got = Buffer.from(s || "");
  return want.length === got.length && timingSafeEqual(want, got);
}
