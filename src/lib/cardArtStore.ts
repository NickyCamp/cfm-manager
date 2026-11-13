// Card art uploaded by league members. Kept in a PRIVATE Supabase Storage bucket
// because photos of real players are usually someone else's copyrighted work:
// they're only ever shown to signed-in members of that league, through
// short-lived signed URLs. Object path: <league slug>/<player id>.jpg
import { currentUser, supabaseAdmin } from "@/lib/supabase/server";
import { getLeagueData } from "@/lib/league/load";

export const CARD_ART_BUCKET = "card-art";
const URL_TTL_SECONDS = 60 * 60;

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
  const { data: m } = await admin.from("league_members").select("role").eq("league_id", lg.id).eq("user_id", user.id).maybeSingle();
  if (lg.owner_id === user.id || m?.role === "commissioner") return { canEdit: true };
  if (!m) return { canEdit: false, why: "Only league members can change card art." };
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

/** Signed URL for a player's uploaded art, or undefined if there is none. Call only for members. */
export async function signedCardArt(slug: string, playerId: number, ttlSeconds = URL_TTL_SECONDS, path = cardArtPath): Promise<string | undefined> {
  try {
    await ensureCardArtBucket();
    const { data } = await supabaseAdmin().storage.from(CARD_ART_BUCKET).createSignedUrl(path(slug, playerId), ttlSeconds);
    return data?.signedUrl;
  } catch (e) {
    console.error("card art url", slug, playerId, e);
    return undefined;
  }
}

/**
 * Signed URLs for whichever of these players have uploaded art (members only).
 * Signs each player's path directly rather than listing the folder: the old
 * folder listing failed silently on the live site, so team pages showed
 * headshots even where art had been uploaded. Paths with no file come back
 * without a URL and are skipped.
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
      const { data, error } = await store.createSignedUrls(chunk.map((id) => path(slug, id)), URL_TTL_SECONDS);
      if (error) { console.error("card art urls", slug, error.message); continue; }
      (data || []).forEach((r, k) => { if (r.signedUrl && !r.error) out.set(chunk[k], r.signedUrl); });
    }
  } catch (e) {
    console.error("card art urls", slug, e);
  }
  return out;
}
