// Team page card showcase (Nick, 2026-11-20): the team's manager picks which 5 cards sit in the
// swipeable stack at the top of the Roster tab. One small JSON file per league in the private
// card-layouts bucket: card-layouts/showcase/<slug>.json = { "<teamId>": [playerId, ...] }.
// Teams with no saved pick fall back to their top 5 by overall.
import { supabaseAdmin } from "@/lib/supabase/server";

const BUCKET = "card-layouts";
export const SHOWCASE_SIZE = 5;
const path = (slug: string) => `showcase/${slug}.json`;

let ready: Promise<void> | null = null;
function ensureBucket() {
  ready ??= (async () => {
    const admin = supabaseAdmin();
    const { data } = await admin.storage.getBucket(BUCKET);
    if (data) return;
    const { error } = await admin.storage.createBucket(BUCKET, { public: false, fileSizeLimit: 512 * 1024, allowedMimeTypes: ["application/json"] });
    if (error && !/already exists/i.test(error.message)) { ready = null; throw error; }
  })();
  return ready;
}

const clean = (ids: unknown): number[] =>
  Array.isArray(ids) ? [...new Set(ids.map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, SHOWCASE_SIZE) : [];

function parse(raw: unknown): Map<number, number[]> {
  const out = new Map<number, number[]>();
  if (raw && typeof raw === "object") {
    for (const [t, ids] of Object.entries(raw as Record<string, unknown>)) {
      const list = clean(ids);
      if (Number(t) > 0 && list.length) out.set(Number(t), list);
    }
  }
  return out;
}

/** The saved showcase for one team (player ids in display order), or [] if none / on any error. */
export async function teamShowcase(slug: string, teamId: number): Promise<number[]> {
  try {
    await ensureBucket();
    const { data, error } = await supabaseAdmin().storage.from(BUCKET).download(path(slug));
    if (error || !data) return [];
    return parse(JSON.parse(await data.text())).get(teamId) ?? [];
  } catch (e) {
    console.error("team showcase", slug, teamId, e);
    return [];
  }
}

/** Save one team's showcase ([] resets it to the top 5). Read-modify-write of the league file;
 *  throws if the file exists but can't be read, so a hiccup can't wipe other teams' picks. */
export async function saveTeamShowcase(slug: string, teamId: number, ids: number[]) {
  await ensureBucket();
  const store = supabaseAdmin().storage.from(BUCKET);
  const { data: files, error: le } = await store.list("showcase", { search: `${slug}.json`, limit: 100 });
  if (le) throw new Error(le.message);
  let all = new Map<number, number[]>();
  if ((files || []).some((f) => f.name === `${slug}.json`)) {
    const { data, error } = await store.download(path(slug));
    if (error || !data) throw new Error(error?.message || "Couldn't read the league's showcases.");
    all = parse(JSON.parse(await data.text()));
  }
  const list = clean(ids);
  if (list.length) all.set(teamId, list); else all.delete(teamId);
  const body = JSON.stringify(Object.fromEntries([...all].map(([t, l]) => [String(t), l])));
  const { error } = await store.upload(path(slug), new Blob([body], { type: "application/json" }), { contentType: "application/json", upsert: true, cacheControl: "0" });
  if (error) throw new Error(error.message);
}
