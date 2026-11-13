// Prints what every bot command would answer for a league, without Discord.
// Usage: npx tsx scripts/discord/preview.ts <slug> [data.json path]
// With no path it downloads the league's public data file (needs NEXT_PUBLIC_SUPABASE_URL).
import fs from "node:fs";
import { gunzipSync } from "node:zlib";
import { _preview as P } from "../../src/lib/discord/handlers";
import { leagueChanges } from "../../src/lib/discord/changes";
import { tidy } from "../../src/lib/discord/api";
import { defaultScoresWeek } from "../../src/lib/league/derive";
import type { LeagueData } from "../../src/lib/league/types";

(async () => {
  const slug = process.argv[2] || "ncl";
  let d: LeagueData;
  if (process.argv[3]) d = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
  else {
    const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/league-data/${slug}/data.json.gz`);
    const buf = Buffer.from(await res.arrayBuffer());
    d = JSON.parse((buf[0] === 0x1f ? gunzipSync(buf) : buf).toString("utf8"));
  }
  const url = (p = "") => `https://example.test/l/${slug}${p}`;
  const footer = { text: slug };
  const show = (label: string, e: object) => {
    const m = tidy({ embeds: [e] });
    const size = JSON.stringify(m).length;
    console.log(`\n===== ${label} (${size} bytes) =====\n${JSON.stringify(m.embeds![0], null, 1)}`);
  };
  const top = [...d.players].filter((p) => p.team && !p.gone).sort((a, b) => b.ovr - a.ovr);
  console.log("autocomplete 'mah':", P.autocompletePlayers(d, "mah", 5).map((p) => `${p.first} ${p.last}`));
  show("player (top)", P.playerEmbed(d, top[0], url, footer));
  show("player (FA)", P.playerEmbed(d, d.players.find((p) => !p.team && !p.gone) || top[1], url, footer));
  show("contract", P.contractEmbed(d, top[3], url, footer));
  show("cap league", P.leagueCapEmbed(d, url, footer));
  show("cap team", P.teamCapEmbed(d, d.teams[0], url, footer));
  show("team", P.teamEmbed(d, d.teams[0], url, footer));
  show("tws NYJ", P.twsEmbed(d, d.teams.find((t) => t.abbr === "NYJ") || d.teams[0], url, footer));
  show("tws SEA 15", P.twsEmbed(d, d.teams.find((t) => t.abbr === "SEA") || d.teams[0], url, footer, 15));
  show("tws SEA 19", P.twsEmbed(d, d.teams.find((t) => t.abbr === "SEA") || d.teams[0], url, footer, 19));
  show("tws first", P.twsEmbed(d, d.teams[0], url, footer));
  show("standings", P.standingsEmbed(d, url, footer));
  show("playoffs", P.playoffsEmbed(d, url, footer));
  const w = defaultScoresWeek(d);
  show("scores", P.scoresEmbed(d, w.stage, w.week, url, footer));

  // Fake a previous build to exercise the update messages.
  const prev: LeagueData = JSON.parse(JSON.stringify(d));
  prev.season = { ...prev.season, week: prev.season.week - 1, title: "Earlier week" };
  const fin = prev.games.filter((g) => g.final).slice(-3); for (const g of fin) g.final = false;
  const ps = prev.players.filter((p) => p.team && !p.ps && !p.gone).slice(0, 4);
  ps[0].team = 0; ps[1].contract = { ...ps[1].contract, length: ps[1].contract.length - 1 };
  ps[2].team = d.teams.find((t) => t.id !== ps[2].team)!.id; ps[3].contract = { ...ps[3].contract, bonus: ps[3].contract.bonus + 1 };
  prev.teams[0].cap = { ...prev.teams[0].cap, available: 5 };
  d.teams[0].cap = { ...d.teams[0].cap, available: -1_000_000 };
  for (const m of leagueChanges(prev, d, slug.toUpperCase(), "https://example.test", slug)) console.log("\n----- update -----\n" + JSON.stringify(tidy(m).embeds![0], null, 1));
})();
