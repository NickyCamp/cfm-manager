// Prints this week's player props for a league from the newest saved sync file, with last season's
// summary attached the way load.ts does it. Checks early-season props without the site.
//   npx tsx scripts/prev-season/preview.ts <slug> <dir with unzipped artifacts>
import fs from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { propMarkets } from "../../src/lib/league/props";
import { PREV_SEEDS } from "../../src/lib/league/prev-seasons";
import type { LeagueData } from "../../src/lib/league/types";

const [slug, dir] = process.argv.slice(2);
let d: LeagueData | null = null;
for (const sub of fs.readdirSync(dir)) {
  const f = path.join(dir, sub, `${slug}.json.gz`);
  if (!fs.existsSync(f)) continue;
  const x = JSON.parse(gunzipSync(fs.readFileSync(f)).toString("utf8")) as LeagueData;
  if (!d || x.pulledAt > d.pulledAt) d = x;
}
if (!d) throw new Error("no data");
if (!d.prevSeason) d.prevSeason = PREV_SEEDS[`${slug}-${d.season.year - 1}`];
console.log(`${d.season.title} · pulled ${d.pulledAt} · last season: ${d.prevSeason ? `${d.prevSeason.year}, ${Object.keys(d.prevSeason.players).length} players` : "none"}`);
const games = d.games.filter((g) => g.stage === d!.season.stage && g.week === d!.season.week && g.home && g.away);
const ms = propMarkets(d, games, d.season.title);
console.log(`${games.length} games → ${ms.length} prop markets, ${ms.reduce((n, m) => n + m.outcomes.length, 0)} lines`);
for (const m of ms.slice(0, 9)) {
  console.log(`\n## ${m.title}`);
  for (const o of m.outcomes) console.log(`  ${(o.p * 100).toFixed(0).padStart(3)}%  ${o.label}  [${o.sub}]`);
}
