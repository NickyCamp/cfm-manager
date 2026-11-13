import { gunzipSync } from "node:zlib";
import { playerFacts, teamFacts } from "../../src/lib/discord/funfacts";
import type { LeagueData } from "../../src/lib/league/types";
(async () => {
  const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/league-data/ncl/data.json.gz`);
  const buf = Buffer.from(await res.arrayBuffer());
  const d: LeagueData = JSON.parse((buf[0] === 0x1f ? gunzipSync(buf) : buf).toString("utf8"));
  const pick = (last: string, pos?: string) => d.players.find((p) => p.last === last && (!pos || p.pos === pos) && !p.gone);
  for (const p of [pick("Ward", "QB"), pick("Allen", "QB"), pick("Smith-Njigba"), pick("Robinson", "HB"), pick("Garrett"), pick("Aubrey")].filter(Boolean)) {
    console.log(`\n### ${p!.first} ${p!.last} (${p!.pos})`);
    for (const f of playerFacts(d, p!)) console.log(`[${f.weight}] ${f.text}`);
  }
  for (const abbr of ["NYJ", "BUF", "TEN"]) {
    const t = d.teams.find((x) => x.abbr === abbr)!;
    console.log(`\n### ${t.city} ${t.name}`);
    for (const f of teamFacts(d, t)) console.log(`[${f.weight}] ${f.text}`);
  }
})();
