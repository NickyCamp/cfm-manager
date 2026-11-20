// Recovers a league's last-season summary (src/lib/league/prevSeason.ts) from saved sync files.
// Used once for NCL 2027 (Nick, 2026-11-20): the league rolled over to 2028 before the worker kept
// last season's numbers. Run by .github/workflows/recover-prev-season.yml.
//
//   npx tsx scripts/prev-season/summarize.ts <slug> <year> <dir with unzipped artifacts>
//
// Looks through <dir>/*/<slug>.json.gz, takes the newest file whose season is <year> with stat lines,
// and writes src/lib/league/prev-seasons/<slug>-<year>.json.

import fs from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { summarizeSeason } from "../../src/lib/league/prevSeason";
import type { LeagueData } from "../../src/lib/league/types";

const [slug, yearArg, dir] = process.argv.slice(2);
const year = Number(yearArg);
if (!slug || !year || !dir) throw new Error("usage: summarize.ts <slug> <year> <dir>");

let best: { at: string; d: LeagueData; file: string } | null = null;
for (const sub of fs.readdirSync(dir)) {
  const file = path.join(dir, sub, `${slug}.json.gz`);
  if (!fs.existsSync(file)) continue;
  try {
    const d = JSON.parse(gunzipSync(fs.readFileSync(file)).toString("utf8")) as LeagueData;
    console.log(`${file}: ${d.season?.year} ${d.season?.title} · ${d.lines?.length ?? 0} lines · pulled ${d.pulledAt}`);
    if (d.season?.year !== year || !d.lines?.length) continue;
    if (!best || d.pulledAt > best.at) best = { at: d.pulledAt, d, file };
  } catch (e) {
    console.log(`${file}: unreadable (${(e as Error).message})`);
  }
}
if (!best) throw new Error(`No saved ${slug} data for ${year} with stat lines`);
const sum = summarizeSeason(best.d);
fs.mkdirSync("src/lib/league/prev-seasons", { recursive: true });
const out = path.join("src/lib/league/prev-seasons", `${slug}-${year}.json`);
fs.writeFileSync(out, JSON.stringify(sum));
console.log(`Using ${best.file} (pulled ${best.at}): ${Object.keys(sum.players).length} players → ${out}`);
