import { gunzipSync } from "node:zlib";
import { healRenumberedLog } from "../../src/lib/league/teamIds";
import { backlogPosts } from "../../src/lib/discord/txPosts";
const base = `${process.env.SUPABASE_URL}/storage/v1/object/public/league-data/ncl`;
const get = async (f: string) => { const r = await fetch(`${base}/${f}`); if (!r.ok) { console.log(f, r.status); return null; } return JSON.parse(gunzipSync(Buffer.from(await r.arrayBuffer())).toString("utf8")); };
(async () => {
  const d = await get("data.json.gz"), h = await get("history.json.gz");
  const ids = new Set<number>(d.teams.map((t: any) => t.id));
  const r = healRenumberedLog(h, d);
  const unknown = r.hist.events.filter((e: any) => (e.from && !ids.has(e.from)) || (e.to && !ids.has(e.to)));
  console.log("DRYRUN events", h.events.length, "->", r.hist.events.length, "dropped", r.dropped, "fixed", r.fixed, "still unknown", unknown.length, unknown.slice(0, 5).map((e: any) => `${e.kind} ${e.from}->${e.to} ${e.at}`).join(" | "));
  const b: any = backlogPosts(r.hist, d, { ...d, pulledAt: "x" }, { appUrl: "https://x", slug: "ncl", leagueName: "NCL", trade: null });
  for (const k of Object.keys(b)) {
    const txt = b[k].map((m: any) => m.embeds[0].description).join("\n");
    console.log("DRYRUN", k, "msgs", b[k].length, "lines with ?", (txt.match(/\?[ ,)]/g) || []).length, "|", txt.split("\n").slice(1, 3).join(" / ").slice(0, 300));
  }
})();
