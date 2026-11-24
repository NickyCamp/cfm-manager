// Card art uploaded by league members. Kept in a PRIVATE Supabase Storage bucket
// because photos of real players are usually someone else's copyrighted work:
// they're only ever shown to signed-in members of that league, through
// signed links to our own image route (cardArtLink). Object path: <league slug>/<player id>.jpg
import { currentUser, supabaseAdmin } from "@/lib/supabase/server";
import { getLeagueData } from "@/lib/league/load";
import { isMaddenAdmin } from "@/lib/marketStore";
import { createHmac, timingSafeEqual } from "node:crypto";
import { storageObject } from "@/lib/storageCache";

export const CARD_ART_BUCKET = "card-art";

let bucketReady: Promise<void> | null = null;
/** Creates the private bucket the first time it's needed. */
export function ensureCardArtBucket() {
  bucketReady ??= (async () => {
    const admin = supabaseAdmin();
    const { data } = await admin.storage.getBucket(CARD_ART_BUCKET);
    if (data) return;
    const { error } = await admin.storage.createBucket(CARD_ART_BUCKET, {
      public: false,
      fileSizeLimit: 3 * 1024 * 1024,
      allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
    });
    if (error && !/already exists/i.test(error.message)) { bucketReady = null; throw error; }
  })();
  return bucketReady;
}

export const cardArtPath = (slug: string, playerId: number) => `${slug}/${playerId}.jpg`;
/** A card's uploaded custom border (card builder): transparent PNG, same 5:7 shape as the card. */
export const cardFramePath = (slug: string, playerId: number) => `${slug}/${playerId}.frame.png`;

/**
 * Whether the visitor may SEE card art: anyone signed in (Nick's call, 2026-11-13:
 * accounts are tied to EA leagues, so signed-in visitors are league people).
 * Changing art needs cardArtAccess() (team owner or commissioner).
 */
export async function canSeeCardArt(): Promise<boolean> {
  return Boolean(await currentUser().catch(() => null));
}

/** The signed-in user's id if they own or belong to the league, else null. */
export async function leagueMemberId(slug: string): Promise<string | null> {
  const user = await currentUser().catch(() => null);
  if (!user) return null;
  const admin = supabaseAdmin();
  const { data: lg } = await admin.from("leagues").select("id, owner_id").eq("slug", slug).maybeSingle();
  if (!lg) return null;
  if (lg.owner_id === user.id) return user.id;
  const { data: m } = await admin.from("league_members").select("user_id").eq("league_id", lg.id).eq("user_id", user.id).maybeSingle();
  return m ? user.id : null;
}

const normName = (s: string) => s.trim().toLowerCase();

/**
 * Whether the signed-in user may change one player's card art (Nick's rule, 2026-11-13:
 * stop people pranking other teams' cards).
 * - The league's commissioner/owner can change any card.
 * - Other members can change cards of players on the team they run. "The team they run"
 *   comes from EA itself: each team in the export carries the PSN/Xbox name of the person
 *   controlling it (Team.user), and we match that against the EA persona names the user
 *   connected. It re-checks against the latest sync, so a team change is picked up.
 * - Free agents, CPU teams and departed players: commissioner only.
 */
export async function cardArtAccess(slug: string, playerTeamId: number | undefined): Promise<{ canEdit: boolean; why?: string }> {
  const user = await currentUser().catch(() => null);
  if (!user) return { canEdit: false };
  const admin = supabaseAdmin();
  const { data: lg } = await admin.from("leagues").select("id, owner_id").eq("slug", slug).maybeSingle();
  if (!lg) return { canEdit: false };
  const { data: m } = await admin.from("league_members").select("role, team_abbr").eq("league_id", lg.id).eq("user_id", user.id).maybeSingle();
  if (lg.owner_id === user.id || m?.role === "commissioner") return { canEdit: true };
  if (!m) return { canEdit: false, why: "Only league members can change card art." };
  if (await isMaddenAdmin(slug, user.id, m.team_abbr)) return { canEdit: true };
  const notYours = "You can only change card art for players on your own team.";
  if (!playerTeamId) return { canEdit: false, why: notYours };
  const [{ data: conns }, data] = await Promise.all([
    admin.from("ea_connections").select("persona_name").eq("user_id", user.id),
    getLeagueData(slug).catch(() => null),
  ]);
  const mine = new Set((conns || []).map((c) => normName(c.persona_name || "")).filter(Boolean));
  const team = data?.teams.find((t) => t.id === playerTeamId);
  if (team?.user && mine.has(normName(team.user))) return { canEdit: true };
  return { canEdit: false, why: notYours };
}

// Pages show uploaded art through our own route (/api/leagues/<slug>/card-art/<id>/img), not
// Supabase signed URLs (2026-11-24): a signed URL changed on every page view, so browsers never kept
// the image and every view downloaded it from Supabase again. The route's links are signed with
// EA_TOKEN_KEY and stay the same for a day, so browsers keep the image; the route keeps the file in
// memory (storageCache.ts), so Supabase is only asked whether it changed, about once a minute.
const DAY = 86400;
function artSig(slug: string, playerId: number, frame: boolean, exp: number) {
  const k = process.env.EA_TOKEN_KEY?.trim();
  if (!k) throw new Error("EA_TOKEN_KEY is not set.");
  return createHmac("sha256", `card-art:${k}`).update(`${slug}/${playerId}/${frame ? "f" : "a"}/${exp}`).digest("base64url").slice(0, 22);
}

/** Link to a player's uploaded art (or custom border) for the site. Works for a day or two; the same all day. */
export function cardArtLink(slug: string, playerId: number, frame = false) {
  const exp = (Math.floor(Date.now() / 1000 / DAY) + 2) * DAY;
  return `/api/leagues/${encodeURIComponent(slug)}/card-art/${playerId}/img?${frame ? "f=1&" : ""}e=${exp}&s=${artSig(slug, playerId, frame, exp)}`;
}

export function checkCardArtLink(slug: string, playerId: number, frame: boolean, exp: number, s: string) {
  if (!slug || !(playerId > 0) || !exp || exp * 1000 < Date.now()) return false;
  const want = Buffer.from(artSig(slug, playerId, frame, exp)), got = Buffer.from(s || "");
  return want.length === got.length && timingSafeEqual(want, got);
}

/** The uploaded art (or border) file itself, from memory when checked in the last minute. */
export function cardArtFile(slug: string, playerId: number, path = cardArtPath) {
  return storageObject(CARD_ART_BUCKET, path(slug, playerId));
}

/** Uploaded art as a data URL for the Discord card images (PNG/JPEG only), or undefined if there is none. */
export async function cardArtData(slug: string, playerId: number, path = cardArtPath): Promise<string | undefined> {
  try {
    const f = await cardArtFile(slug, playerId, path);
    if (!f || !/^image\/(png|jpeg)$/.test(f.type)) return undefined;
    return `data:${f.type};base64,${f.buf.toString("base64")}`;
  } catch (e) {
    console.error("card art data", slug, playerId, e);
    return undefined;
  }
}

/** Link to a player's uploaded art for the site, or undefined if there is none. Call only for members. */
export async function signedCardArt(slug: string, playerId: number, path = cardArtPath): Promise<string | undefined> {
  try {
    await ensureCardArtBucket();
    // Signing only checks the file exists (no download); the page gets our own link.
    const { data } = await supabaseAdmin().storage.from(CARD_ART_BUCKET).createSignedUrl(path(slug, playerId), 60);
    return data?.signedUrl ? cardArtLink(slug, playerId, path === cardFramePath) : undefined;
  } catch (e) {
    console.error("card art url", slug, playerId, e);
    return undefined;
  }
}

/**
 * Links for whichever of these players have uploaded art (members only).
 * Signs each player's path directly rather than listing the folder: the old
 * folder listing failed silently on the live site, so team pages showed
 * headshots even where art had been uploaded. Paths with no file come back
 * without a URL and are skipped. Signing is only the existence check.
 */
export async function signedCardArtFor(slug: string, playerIds: number[], path = cardArtPath): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  const ids = [...new Set(playerIds)].filter((id) => id > 0);
  if (!ids.length) return out;
  try {
    await ensureCardArtBucket();
    const store = supabaseAdmin().storage.from(CARD_ART_BUCKET);
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      const { data, error } = await store.createSignedUrls(chunk.map((id) => path(slug, id)), 60);
      if (error) { console.error("card art urls", slug, error.message); continue; }
      (data || []).forEach((r, k) => { if (r.signedUrl && !r.error) out.set(chunk[k], cardArtLink(slug, chunk[k], path === cardFramePath)); });
    }
  } catch (e) {
    console.error("card art urls", slug, e);
  }
  return out;
}

/**
 * Whether the signed-in user may set a player's nickname (Nick, 2026-11-13: "limited to the
 * user who manages the team"). Stricter than card art: on a team run by a person, only that
 * person (matched by EA name, like card art). The commissioner only handles players with no
 * person behind them: CPU teams and free agents.
 */
export async function nicknameAccess(slug: string, playerTeamId: number | undefined): Promise<{ canEdit: boolean; why?: string }> {
  const user = await currentUser().catch(() => null);
  if (!user) return { canEdit: false };
  const admin = supabaseAdmin();
  const { data: lg } = await admin.from("leagues").select("id, owner_id").eq("slug", slug).maybeSingle();
  if (!lg) return { canEdit: false };
  const { data: m } = await admin.from("league_members").select("role, team_abbr").eq("league_id", lg.id).eq("user_id", user.id).maybeSingle();
  const commish = lg.owner_id === user.id || m?.role === "commissioner" || (Boolean(m) && (await isMaddenAdmin(slug, user.id, m?.team_abbr)));
  if (!m && !commish) return { canEdit: false, why: "Only league members can set nicknames." };
  const [{ data: conns }, data] = await Promise.all([
    admin.from("ea_connections").select("persona_name").eq("user_id", user.id),
    getLeagueData(slug).catch(() => null),
  ]);
  const team = playerTeamId ? data?.teams.find((t) => t.id === playerTeamId) : undefined;
  if (team?.user) {
    const mine = new Set((conns || []).map((c) => normName(c.persona_name || "")).filter(Boolean));
    if (mine.has(normName(team.user))) return { canEdit: true };
    return { canEdit: false, why: "Only the person running this player's team can set his nickname." };
  }
  // CPU team or free agent: nobody manages him, so the commissioner can.
  if (commish) return { canEdit: true };
  return { canEdit: false, why: "Only the commissioner can nickname free agents and CPU-team players." };
}
