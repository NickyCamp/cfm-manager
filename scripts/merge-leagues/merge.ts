// Merges duplicate copies of the same EA league into one.
//
// Why duplicates exist: leagues used to be keyed by (EA league id, console), so a
// PC player adding a cross-play league that a PS5 player had already added got a
// separate "PC" copy with its own web address, members and card art. The join
// route now matches on the EA league id alone; this cleans up copies made before.
//
// For each EA league id with more than one row, the oldest league is kept. From
// every other copy it:
//   1. adds that copy's members to the kept league (as members),
//   2. copies its card art across (the newer image wins when both have one),
//   3. deletes the copy: its league row (members and sync runs cascade) and its
//      files in the league-data and card-art buckets.
//
// Run: MODE=dry|apply npx tsx scripts/merge-leagues/merge.ts
// (the "Merge duplicate leagues" workflow runs it with the Supabase secrets).
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
const apply = process.env.MODE === "apply";
const db = createClient(url, key, { auth: { persistSession: false } });

type League = { id: string; slug: string; name: string; ea_league_id: number; console: string; owner_id: string; created_at: string };
type FileRow = { name: string; updated_at?: string | null; created_at?: string | null; id?: string | null };

/** Every file under a folder (paginated; folders come back with id null). */
async function listAll(bucket: string, prefix: string): Promise<FileRow[]> {
  const out: FileRow[] = [];
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await db.storage.from(bucket).list(prefix, { limit: 100, offset });
    if (error) throw new Error(`list ${bucket}/${prefix}: ${error.message}`);
    out.push(...(data || []));
    if (!data || data.length < 100) return out;
  }
}

/** Paths of every file under a folder, one level of subfolders deep. */
async function allPaths(bucket: string, prefix: string): Promise<string[]> {
  const paths: string[] = [];
  for (const f of await listAll(bucket, prefix)) {
    if (f.id === null) for (const g of await listAll(bucket, `${prefix}/${f.name}`)) paths.push(`${prefix}/${f.name}/${g.name}`);
    else paths.push(`${prefix}/${f.name}`);
  }
  return paths;
}

const time = (f?: FileRow) => Date.parse(f?.updated_at || f?.created_at || "") || 0;

const { data: leagues, error } = await db.from("leagues").select("id, slug, name, ea_league_id, console, owner_id, created_at").order("created_at");
if (error) throw error;
const groups = new Map<number, League[]>();
for (const l of leagues as League[]) groups.set(l.ea_league_id, [...(groups.get(l.ea_league_id) || []), l]);

let found = 0;
for (const [eaId, list] of groups) {
  if (list.length < 2) continue;
  found++;
  const [keep, ...dups] = list; // oldest first
  console.log(`\nEA league ${eaId}: keeping /l/${keep.slug} (${keep.console}, ${keep.name}, added ${keep.created_at})`);
  const keepArt = new Map((await listAll("card-art", keep.slug)).filter((f) => f.id !== null).map((f) => [f.name, f]));

  for (const dup of dups) {
    console.log(`  copy /l/${dup.slug} (${dup.console}, ${dup.name}, added ${dup.created_at})`);
    const { data: members } = await db.from("league_members").select("user_id").eq("league_id", dup.id);
    const userIds = [...new Set([dup.owner_id, ...(members || []).map((m) => m.user_id)])];
    console.log(`    members to add: ${userIds.length}`);

    const dupArt = (await listAll("card-art", dup.slug)).filter((f) => f.id !== null);
    const toCopy = dupArt.filter((f) => !keepArt.has(f.name) || time(f) > time(keepArt.get(f.name)));
    console.log(`    card art: ${dupArt.length} on the copy, ${toCopy.length} to copy over (${toCopy.map((f) => f.name).join(", ") || "none"})`);
    const dataFiles = await allPaths("league-data", dup.slug);
    console.log(`    league-data files to delete: ${dataFiles.length}`);

    if (!apply) continue;
    for (const user_id of userIds) {
      const { error: e } = await db.from("league_members").upsert(
        { league_id: keep.id, user_id, role: user_id === keep.owner_id ? "commissioner" : "member" },
        { onConflict: "league_id,user_id", ignoreDuplicates: true });
      if (e) throw new Error(`add member: ${e.message}`);
    }
    for (const f of toCopy) {
      const { data: blob, error: e1 } = await db.storage.from("card-art").download(`${dup.slug}/${f.name}`);
      if (e1 || !blob) throw new Error(`download art ${f.name}: ${e1?.message}`);
      const { error: e2 } = await db.storage.from("card-art").upload(`${keep.slug}/${f.name}`, await blob.arrayBuffer(), { contentType: "image/jpeg", upsert: true, cacheControl: "60" });
      if (e2) throw new Error(`upload art ${f.name}: ${e2.message}`);
    }
    const { error: e3 } = await db.from("leagues").delete().eq("id", dup.id);
    if (e3) throw new Error(`delete league: ${e3.message}`);
    if (dupArt.length) await db.storage.from("card-art").remove(dupArt.map((f) => `${dup.slug}/${f.name}`));
    for (let i = 0; i < dataFiles.length; i += 100) await db.storage.from("league-data").remove(dataFiles.slice(i, i + 100));
    console.log(`    merged and deleted /l/${dup.slug}`);
  }
}
console.log(found ? `\n${found} duplicated league(s). ${apply ? "Applied." : "Dry run: nothing changed."}` : "No duplicate leagues.");
