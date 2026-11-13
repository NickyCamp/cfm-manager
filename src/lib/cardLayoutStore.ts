// Card builder layouts (see src/lib/league/cardLayout.ts), one small JSON file per league in a
// private Supabase Storage bucket: card-layouts/<slug>.json = { "<playerId>": { frame: false, nameFont: "anton", ... } }.
// One file per league so a team page loads every card's layout in one request. Only cards
// that differ from the default are stored, and only their changed settings.
import { supabaseAdmin } from "@/lib/supabase/server";
import { normalizeLayout, isDefaultLayout, layoutDiff, type CardLayout } from "@/lib/league/cardLayout";

const BUCKET = "card-layouts";
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

/** Every saved layout in the league (player id → layout). Empty on any error, so cards fall back to the default. */
export async function leagueCardLayouts(slug: string): Promise<Map<number, CardLayout>> {
  const out = new Map<number, CardLayout>();
  try {
    await ensureBucket();
    const { data, error } = await supabaseAdmin().storage.from(BUCKET).download(`${slug}.json`);
    if (error || !data) return out;
    const raw = JSON.parse(await data.text()) as Record<string, unknown>;
    for (const [id, l] of Object.entries(raw || {})) if (Number(id) > 0) out.set(Number(id), normalizeLayout(l));
  } catch (e) {
    console.error("card layouts", slug, e);
  }
  return out;
}

export async function cardLayout(slug: string, playerId: number): Promise<CardLayout | undefined> {
  return (await leagueCardLayouts(slug)).get(playerId);
}

/** Save one card's layout (null or all-on removes it). Read-modify-write of the league file. */
export async function saveCardLayout(slug: string, playerId: number, layout: CardLayout | null) {
  await ensureBucket();
  const all = await leagueCardLayouts(slug);
  const l = layout ? normalizeLayout(layout) : null;
  if (!l || isDefaultLayout(l)) all.delete(playerId);
  else all.set(playerId, l);
  const body = JSON.stringify(Object.fromEntries([...all].map(([id, l]) => [String(id), layoutDiff(l)])));
  const { error } = await supabaseAdmin().storage.from(BUCKET)
    .upload(`${slug}.json`, new Blob([body], { type: "application/json" }), { contentType: "application/json", upsert: true, cacheControl: "0" });
  if (error) throw new Error(error.message);
}
