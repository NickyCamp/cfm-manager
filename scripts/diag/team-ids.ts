import { gunzipSync } from "node:zlib";
const base = `${process.env.SUPABASE_URL}/storage/v1/object/public/league-data/ncl`;
const get = async (f: string) => { const r = await fetch(`${base}/${f}`); if (!r.ok) { console.log(f, r.status); return null; } return JSON.parse(gunzipSync(Buffer.from(await r.arrayBuffer())).toString("utf8")); };
(async () => {
  const d = await get("data.json.gz"), h = await get("history.json.gz");
  const ids = new Set<number>(d.teams.map((t: any) => t.id));
  console.log("teams", d.teams.slice(0, 4).map((t: any) => `${t.id}:${JSON.stringify(t.abbr)}`).join(" "), "count", d.teams.length);
  const g = d.games.filter((x: any) => x.final);
  console.log("final games", g.length, "home id miss", g.filter((x: any) => !ids.has(x.home)).length, "sample", g.slice(0, 3).map((x: any) => `${x.away}@${x.home}`).join(" "));
  const pl = d.players.filter((p: any) => p.team > 0);
  console.log("rostered", pl.length, "team miss", pl.filter((p: any) => !ids.has(p.team)).length, "sample", pl.slice(0, 3).map((p: any) => p.team).join(" "));
  const ev = h?.events || [];
  const miss = ev.filter((e: any) => (e.from && !ids.has(e.from)) || (e.to && !ids.has(e.to)));
  console.log("events", ev.length, "with unknown team", miss.length, "sample", miss.slice(0, 5).map((e: any) => `${e.kind} ${e.from}->${e.to} ${e.at}`).join(" | "));
  const ok = ev.filter((e: any) => (e.from && ids.has(e.from)) || (e.to && ids.has(e.to)));
  console.log("events with known team", ok.length, ok.slice(-2).map((e: any) => `${e.kind} ${e.from}->${e.to} ${e.at}`).join(" | "));
  console.log("typeof team id", typeof d.teams[0].id, "typeof game home", typeof g[0]?.home);
})();
