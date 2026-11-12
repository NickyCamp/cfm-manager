// Refreshes src/lib/league/headshots.json from nflverse's players file
// (https://github.com/nflverse/nflverse-data, released as "players").
// Run: node scripts/headshots/update.mjs   (a weekly GitHub Action runs it too)
//
// Each row: [names, born, college, rookieYear, posGroup, img, lastName]
//   names   - every way the player's name is written (display, legal, football name), normalized
//   born    - "YYYY-MM-DD" or ""
//   img     - the part of the NFL.com image URL after /image/, minus the transform,
//             e.g. "upload/league/wdckwtob1lybvkmxnf7p" (see headshots.ts)
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { normName } from "./norm.mjs";

const SRC = "https://github.com/nflverse/nflverse-data/releases/download/players/players.csv";
const OUT = fileURLToPath(new URL("../../src/lib/league/headshots.json", import.meta.url));
// Players whose last NFL season is older than this can't be on a current Madden roster.
const MIN_LAST_SEASON = 2022;

function parseCsv(text) {
  const rows = [];
  let row = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
    else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows;
  return body.filter((r) => r.length === head.length).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

const res = await fetch(SRC);
if (!res.ok) throw new Error(`nflverse players: HTTP ${res.status}`);
const players = parseCsv(await res.text());

const out = [];
for (const p of players) {
  if (!(Number(p.last_season) >= MIN_LAST_SEASON)) continue;
  const m = /static\.www\.nfl\.com\/image\/(upload|private)\/[^/]*\/(?:v\d+\/)?(league\/[a-z0-9]+)$/i.exec(p.headshot || "");
  if (!m) continue;
  const names = new Set();
  for (const first of [p.first_name, p.common_first_name, p.football_name]) {
    if (first && p.last_name) names.add(normName(`${first} ${p.last_name}`));
  }
  if (p.display_name) names.add(normName(p.display_name));
  names.delete("");
  if (!names.size) continue;
  out.push([[...names], p.birth_date || "", p.college_name || "", Number(p.rookie_season) || Number(p.draft_year) || 0, p.position_group || "", `${m[1]}/${m[2]}`, normName(p.last_name)]);
}
out.sort((a, b) => a[0][0].localeCompare(b[0][0]));
writeFileSync(OUT, JSON.stringify(out) + "\n");
console.log(`headshots.json: ${out.length} players (of ${players.length} in nflverse)`);
