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

/** Signed URLs for every player in the league that has uploaded art (members only). */
export async function signedCardArtMap(slug: string): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  try {
    await ensureCardArtBucket();
    const store = supabaseAdmin().storage.from(CARD_ART_BUCKET);
    const { data: files } = await store.list(slug, { limit: 1000 });
    const paths = (files || []).map((f) => f.name).filter((n) => /^\d+\.jpg$/.test(n)).map((n) => `${slug}/${n}`);
    if (!paths.length) return out;
    const { data } = await store.createSignedUrls(paths, URL_TTL_SECONDS);
    for (const r of data || []) {
      const id = Number(r.path?.split("/")[1]?.replace(".jpg", ""));
      if (r.signedUrl && id) out.set(id, r.signedUrl);
    }
  } catch (e) {
    console.error("card art map", slug, e);
  }
  return out;
}
