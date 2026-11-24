// Keeps Supabase Storage files in this server's memory so each page view or Discord image doesn't
// download them again (2026-11-24: the free plan's 5 GB of cached egress ran out in under a month,
// mostly the league data files re-downloaded every minute by every server instance).
//
// A file is re-checked at most once a minute with If-Modified-Since. Storage answers 304 with no
// body when it hasn't changed (checked live on league-data), so a check costs almost nothing and a
// new sync, card art upload or video still shows within about a minute everywhere.

type Entry = { buf: Buffer; type: string; lastModified: string | null; checkedAt: number; bytes: number };

const entries = new Map<string, Entry>();
const pending = new Map<string, Promise<Entry | null>>();
const RECHECK_MS = 60_000;
const MAX_TOTAL_BYTES = 120 * 1024 * 1024; // what one instance may hold; least recently used goes first
const MAX_ITEM_BYTES = 12 * 1024 * 1024; // alert videos are up to 10 MB
let total = 0;

function remember(key: string, e: Entry) {
  const old = entries.get(key);
  if (old) { total -= old.bytes; entries.delete(key); }
  if (e.bytes > MAX_ITEM_BYTES) return;
  entries.set(key, e);
  total += e.bytes;
  for (const [k, v] of entries) {
    if (total <= MAX_TOTAL_BYTES) break;
    entries.delete(k);
    total -= v.bytes;
  }
}

function touch(key: string, e: Entry) {
  entries.delete(key);
  entries.set(key, e);
}

const base = () => process.env.NEXT_PUBLIC_SUPABASE_URL;

/** Where a storage object lives: public buckets by public URL, private ones through the service role. */
function request(bucket: string, path: string, isPublic: boolean): { url: string; headers: Record<string, string> } {
  const p = path.split("/").map(encodeURIComponent).join("/");
  if (isPublic) return { url: `${base()}/storage/v1/object/public/${bucket}/${p}`, headers: {} };
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  return { url: `${base()}/storage/v1/object/authenticated/${bucket}/${p}`, headers: { authorization: `Bearer ${key}`, apikey: key } };
}

async function load(key: string, bucket: string, path: string, isPublic: boolean, hit: Entry | undefined): Promise<Entry | null> {
  const { url, headers } = request(bucket, path, isPublic);
  const h: Record<string, string> = { ...headers };
  if (hit?.lastModified) h["if-modified-since"] = hit.lastModified;
  const res = await fetch(url, { headers: h, cache: "no-store" });
  if (res.status === 304 && hit) {
    hit.checkedAt = Date.now();
    touch(key, hit);
    return hit;
  }
  if (res.status === 400 || res.status === 404) {
    // Gone (or never there). Storage answers a missing object with 400 on some routes.
    if (hit) { total -= hit.bytes; entries.delete(key); }
    return null;
  }
  if (!res.ok) throw new Error(`storage ${res.status} for ${bucket}/${path}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const e: Entry = { buf, type: (res.headers.get("content-type") || "").split(";")[0], lastModified: res.headers.get("last-modified"), checkedAt: Date.now(), bytes: buf.length };
  remember(key, e);
  return e;
}

/**
 * A storage object's bytes, from memory when checked in the last minute. Returns null when the
 * object doesn't exist. If storage can't be reached, the last copy is used rather than failing.
 */
export async function storageObject(bucket: string, path: string, opts: { public?: boolean } = {}): Promise<{ buf: Buffer; type: string; lastModified: string | null } | null> {
  if (!base()) return null;
  const key = `${bucket}/${path}`;
  const hit = entries.get(key);
  if (hit && Date.now() - hit.checkedAt < RECHECK_MS) { touch(key, hit); return hit; }
  let p = pending.get(key);
  if (!p) {
    p = load(key, bucket, path, opts.public ?? false, hit).catch((e) => {
      console.error("storage cache", key, (e as Error).message);
      return hit ?? null;
    }).finally(() => pending.delete(key));
    pending.set(key, p);
  }
  return p;
}

/** Forgets a cached object on this instance (after an upload or delete here, so it shows at once). */
export function forgetStorageObject(bucket: string, path: string) {
  const key = `${bucket}/${path}`;
  const hit = entries.get(key);
  if (hit) { total -= hit.bytes; entries.delete(key); }
}
