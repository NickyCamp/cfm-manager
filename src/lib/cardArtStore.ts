// Card art uploaded by league members. Kept in a PRIVATE Supabase Storage bucket
// because photos of real players are usually someone else's copyrighted work:
// they're only ever shown to signed-in members of that league, through
// short-lived signed URLs. Object path: <league slug>/<player id>.jpg
import { currentUser, supabaseAdmin } from "@/lib/supabase/server";

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

/**
 * Whether the visitor may SEE card art: anyone signed in (Nick's call, 2026-11-13:
 * accounts are tied to EA leagues, so signed-in visitors are league people).
 * Changing art still needs leagueMemberId().
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

/** Signed URL for a player's uploaded art, or undefined if there is none. Call only for members. */
export async function signedCardArt(slug: string, playerId: number, ttlSeconds = URL_TTL_SECONDS): Promise<string | undefined> {
  try {
    await ensureCardArtBucket();
    const { data } = await supabaseAdmin().storage.from(CARD_ART_BUCKET).createSignedUrl(cardArtPath(slug, playerId), ttlSeconds);
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
export async function signedCardArtFor(slug: string, playerIds: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  const ids = [...new Set(playerIds)].filter((id) => id > 0);
  if (!ids.length) return out;
  try {
    await ensureCardArtBucket();
    const store = supabaseAdmin().storage.from(CARD_ART_BUCKET);
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      const { data, error } = await store.createSignedUrls(chunk.map((id) => cardArtPath(slug, id)), URL_TTL_SECONDS);
      if (error) { console.error("card art urls", slug, error.message); continue; }
      (data || []).forEach((r, k) => { if (r.signedUrl && !r.error) out.set(chunk[k], r.signedUrl); });
    }
  } catch (e) {
    console.error("card art urls", slug, e);
  }
  return out;
}
