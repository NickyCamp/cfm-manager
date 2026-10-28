// Full league pull from EA, ported from ncl-sync/ea/sync.mjs.
// Returns every export as { "<name>.json": data } so the caller can bundle it.

import {
  type BlazeSession, type EaToken, exportCall, leagueHub, refreshToken,
} from "../src/lib/ea/client";

const STATS: [string, string][] = [
  ["passing", "CareerMode_GetWeeklyPassingStatsExport"],
  ["rushing", "CareerMode_GetWeeklyRushingStatsExport"],
  ["receiving", "CareerMode_GetWeeklyReceivingStatsExport"],
  ["defense", "CareerMode_GetWeeklyDefensiveStatsExport"],
  ["teamstats", "CareerMode_GetWeeklyTeamStatsExport"],
  ["kicking", "CareerMode_GetWeeklyKickingStatsExport"],
  ["punting", "CareerMode_GetWeeklyPuntingStatsExport"],
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Hub = any;

/** The league's position: changes on an advance and as games of the current week get played. */
export function leagueKey(hub: Hub) {
  const si = hub.careerHubInfo.seasonInfo;
  const weeks = hub.availableWeekInfoList || [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const played = weeks.reduce((a: number, w: any) => a + (w.gamesPlayedCount || 0), 0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cur = weeks.find((w: any) => w.weekIndex === si.seasonWeek && w.stageIndex === Math.min(si.seasonWeekType, 1)) || {};
  return {
    key: `${si.calendarYear}|${si.seasonWeekType}|${si.seasonWeek}|${played}`,
    label: `${si.calendarYear}, ${cur.weekTitle || `week index ${si.seasonWeek}`} (${played} games played)`,
  };
}

export async function getHub(tok: EaToken, s: BlazeSession, leagueId: number): Promise<Hub> {
  return leagueHub(tok, s, leagueId);
}

export async function fullPull(
  tokIn: EaToken, s: BlazeSession, leagueId: number, hub: Hub, log: (s: string) => void,
): Promise<{ files: Record<string, unknown>; fails: string[]; token: EaToken }> {
  let tok = tokIn;
  const files: Record<string, unknown> = { "league-hub.json": hub };
  const fails: string[] = [];

  for (const [name, type] of [["teams", "CareerMode_GetLeagueTeamsExport"], ["standings", "CareerMode_GetStandingsExport"]]) {
    const r = await exportCall(tok, s, type, { leagueId });
    if (r.ok) files[`${name}.json`] = r.data; else fails.push(`${name}: ${r.error}`);
  }

  const teams = hub.teamIdInfoList || [];
  for (let idx = 0; idx < teams.length; idx++) {
    tok = await refreshToken(tok);
    const r = await exportCall(tok, s, "CareerMode_GetTeamRostersExport", { leagueId, listIndex: idx, returnFreeAgents: false, teamId: teams[idx].teamId }, 8);
    if (r.ok) files[`rosters/${teams[idx].teamId}.json`] = r.data; else fails.push(`roster ${teams[idx].teamId}: ${r.error}`);
    await sleep(400);
  }
  const fa = await exportCall(tok, s, "CareerMode_GetTeamRostersExport", { leagueId, listIndex: -1, returnFreeAgents: true, teamId: 0 }, 8);
  if (fa.ok) files["rosters/freeagents.json"] = fa.data; else fails.push(`free agents: ${fa.error}`);

  let weekCalls = 0;
  for (const w of hub.availableWeekInfoList || []) {
    if (w.stageIndex > 1 || !w.gameTotalCount) continue;
    const body = { leagueId, stageIndex: w.stageIndex, weekIndex: w.weekIndex };
    const tag = `s${w.stageIndex}w${w.weekIndex}`;
    tok = await refreshToken(tok);
    const sch = await exportCall(tok, s, "CareerMode_GetWeeklySchedulesExport", body);
    if (sch.ok) files[`weeks/${tag}/schedule.json`] = sch.data; else fails.push(`${w.weekTitle} schedule: ${sch.error}`);
    weekCalls++;
    if (!w.gamesPlayedCount) continue;
    for (const [name, type] of STATS) {
      const r = await exportCall(tok, s, type, body);
      if (r.ok) files[`weeks/${tag}/${name}.json`] = r.data; else fails.push(`${w.weekTitle} ${name}: ${r.error}`);
      weekCalls++;
      await sleep(200);
    }
  }

  const si = hub.careerHubInfo.seasonInfo;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cur = (hub.availableWeekInfoList || []).find((w: any) => w.weekIndex === si.seasonWeek && w.stageIndex === Math.min(si.seasonWeekType, 1)) || {};
  files["meta.json"] = {
    leagueId, key: leagueKey(hub).key, seasonInfo: si, currentWeekTitle: cur.weekTitle || "",
    currentStage: Math.min(si.seasonWeekType, 1), weeks: hub.availableWeekInfoList || [], pulledAt: new Date().toISOString(),
  };
  log(`- Pulled teams, standings, ${teams.length} rosters + free agents, and ${weekCalls} schedule/stat pages.`);
  return { files, fails, token: tok };
}
