import { gunzipSync } from "node:zlib";
import { playerFacts, teamFacts } from "../../src/lib/discord/funfacts";
import type { LeagueData } from "../../src/lib/league/types";
(async () => {
  const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/league-data/ncl/data.json.gz`);
  const buf = Buffer.from(await res.arrayBuffer());
  const d: LeagueData = JSON.parse((buf[0] === 0x1f ? gunzipSync(buf) : buf).toString("utf8"));
  const roast = (w: number) => w >= 3.4;
  let shown = 0; const kinds = new Map<string, number>();
  const players = d.players.filter((p) => !p.gone && p.team && !p.ps).sort((a, b) => b.contract.capHit - a.contract.capHit);
  let withRoast = 0;
  for (const p of players) {
    const fs = playerFacts(d, p).filter((f) => roast(f.weight));
    if (fs.length) withRoast++;
    for (const f of fs) { const k = f.text.replace(/X/g, "#").replace(/[0-9$.,%]+/g, "").slice(0, 40); kinds.set(k, (kinds.get(k) || 0) + 1); }
    if (shown < 45 && fs.length) { shown++; console.log(`## ${p.first} ${p.last} ${p.pos} ${p.ovr}`); fs.forEach((f) => console.log(`  [${f.weight}] ${f.text}`)); }
  }
  console.log(`${withRoast} of ${players.length} rostered players have at least one roast.`);
  for (const t of d.teams.slice(0, 8)) { const fs = teamFacts(d, t).filter((f) => roast(f.weight)); console.log(`## ${t.name}`); fs.forEach((f) => console.log(`  [${f.weight}] ${f.text}`)); }
  console.log("Kinds:"); [...kinds.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(v, k));
})();
