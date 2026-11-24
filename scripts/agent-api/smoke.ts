// Runs every agent-API tool on a league's newest saved sync files and prints what an agent would get.
//   npx tsx scripts/agent-api/smoke.ts <slug> <dir with unzipped league-data artifacts>
import fs from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";

const [slug, dir] = process.argv.slice(2);
const newest = (file: string, key: (x: { pulledAt?: string; events?: { at: string | null }[] }) => string) => {
  let best: { k: string; text: string } | null = null;
  for (const sub of fs.readdirSync(dir)) {
    const f = path.join(dir, sub, file);
    if (!fs.existsSync(f)) continue;
    const text = gunzipSync(fs.readFileSync(f)).toString("utf8");
    const k = key(JSON.parse(text));
    if (!best || k > best.k) best = { k, text };
  }
  return best?.text ?? null;
};
const local = "/tmp/agent-local";
fs.mkdirSync(local, { recursive: true });
const data = newest(`${slug}.json.gz`, (x) => x.pulledAt || "");
if (!data) throw new Error("no data file in the artifacts");
fs.writeFileSync(`${local}/${slug}.json`, data);
const hist = newest(`${slug}.history.json.gz`, (x) => String(x.events?.length ?? 0).padStart(8, "0"));
if (hist) fs.writeFileSync(`${local}/${slug}.history.json`, hist);
process.env.LOCAL_LEAGUE_DATA = local;

const cases: [string, Record<string, unknown>][] = [
  ["league_info", {}],
  ["week_digest", {}],
  ["week_digest", { week: "1" }],
  ["standings", { conference: "NFC" }],
  ["playoff_picture", {}],
  ["games", { week: "latest" }],
  ["games", { team: "PHI" }],
  ["box_score", { team: "Eagles", week: "latest" }],
  ["find_players", { position: "QB", limit: 5 }],
  ["find_players", { sort: "speed", limit: 5 }],
  ["find_players", { free_agents: true, limit: 5 }],
  ["player", { player: "Patrick Mahomes" }],
  ["player", { player: "mahomes" }],
  ["team", { team: "NO" }],
  ["leaders", {}],
  ["leaders", { category: "rating", limit: 5 }],
  ["transactions", { kind: "trade", limit: 5 }],
  ["transactions", { team: "Saints", limit: 5 }],
  ["cap_overview", { limit: 5 }],
  ["dev_watch", { limit: 5 }],
  ["player", { player: "Nobody Atall" }],
  ["team", { team: "XYZ" }],
];

(async () => {
  const { runTool, ToolError } = await import("../../src/lib/agent/tools");
  let fails = 0;
  for (const [name, args] of cases) {
    const t0 = Date.now();
    try {
      const out = JSON.stringify(await runTool(slug, name, args));
      const full = process.env.FULL === name;
      console.log(`\n### ${name} ${JSON.stringify(args)}: ${out.length} chars, ${Date.now() - t0} ms\n${full ? out : out.slice(0, 1800)}${!full && out.length > 1800 ? " …" : ""}`);
    } catch (e) {
      const expected = e instanceof ToolError;
      if (!expected) fails++;
      console.log(`\n### ${name} ${JSON.stringify(args)}: ${expected ? "tool error (expected for bad input)" : "CRASH"}: ${(e as Error).stack || e}`);
    }
  }
  if (fails) { console.log(`\n${fails} crash(es)`); process.exit(1); }
})();
