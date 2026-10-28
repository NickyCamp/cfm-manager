// Dev helper: build LeagueData from an unpacked raw pull directory.
// npx tsx scripts/build-local.ts <raw-dir> <out.json>
import fs from "node:fs";
import path from "node:path";
import { buildLeagueData } from "../src/lib/league/build";

const [dir, out] = process.argv.slice(2);
const files: Record<string, unknown> = {};
const walk = (d: string) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith(".json")) files[path.relative(dir, p).split(path.sep).join("/")] = JSON.parse(fs.readFileSync(p, "utf8"));
  }
};
walk(dir);
const data = buildLeagueData(files);
fs.writeFileSync(out, JSON.stringify(data));
console.log(`${data.teams.length} teams, ${data.players.length} players, ${data.games.length} games, ${data.lines.length} lines, ${data.teamGames.length} team-games, ${(fs.statSync(out).size / 1e6).toFixed(2)} MB`);
