// Turns one raw EA pull ({ "<file>.json": data }) into the LeagueData the
// league pages read. Runs in the sync worker after every pull.
//
// Conversion rules carried over from ncl-sync/ea/to_export.py, where each was
// checked against a real MyMadden export of the same league:
// - capHit and capReleasePenalty arrive divided by 10,000. Every other money
//   field is already in dollars.
// - winLossStreak arrives as an unsigned byte (255 = -1).
// - Playoff games not set yet come back as several TBD-vs-TBD rows per round.

import { DATA_VERSION, type Game, type LeagueData, type Player, type StatLine, type Team, type TeamGame, type Week } from "./types";

type Raw = Record<string, unknown>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

function list(files: Raw, name: string): Any[] {
  const d = files[name] as Record<string, unknown> | undefined;
  if (!d) return [];
  const v = Object.values(d).find(Array.isArray);
  return (v as Any[]) || [];
}

const hex = (n: number) => "#" + (Number(n) >>> 0 & 0xffffff).toString(16).padStart(6, "0").toUpperCase();
const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : 0);
const signedByte = (n: number) => (n > 127 ? n - 256 : n);

export function buildLeagueData(files: Raw): LeagueData {
  const meta = files["meta.json"] as Any;
  const hub = files["league-hub.json"] as Any;
  const si = meta.seasonInfo;

  // ---------- weeks ----------
  const weeks: Week[] = (meta.weeks || [])
    .filter((w: Any) => w.gameTotalCount > 0)
    .map((w: Any) => ({ stage: w.stageIndex, week: w.weekIndex, title: w.weekTitle, games: w.gameTotalCount, played: w.gamesPlayedCount }));

  // ---------- games ----------
  const simmedByMatchup = new Map<string, boolean>();
  for (const g of hub?.gameScheduleHubInfo?.leagueSchedule || []) {
    const sg = g.seasonGameInfo || {};
    if (sg.isGamePlayed && sg.homeTeam && sg.awayTeam) simmedByMatchup.set(`${sg.homeTeam}:${sg.awayTeam}`, (sg.numberTimesPlayed || 0) === 0);
  }
  const games: Game[] = [];
  const seenTbd = new Set<string>();
  for (const name of Object.keys(files).filter((n) => /^weeks\/s\d+w\d+\/schedule\.json$/.test(n))) {
    for (const g of list(files, name)) {
      if (!g.homeTeamId && !g.awayTeamId) {
        const k = `${g.stageIndex}:${g.weekIndex}`;
        if (seenTbd.has(k)) continue;
        seenTbd.add(k);
      }
      const isCurrent = g.stageIndex === Math.min(si.seasonWeekType, 1) && g.weekIndex === si.seasonWeek;
      const simmed = isCurrent ? simmedByMatchup.get(`${g.homeTeamId}:${g.awayTeamId}`) : undefined;
      games.push({
        id: g.scheduleId, stage: g.stageIndex, week: g.weekIndex, home: g.homeTeamId || 0, away: g.awayTeamId || 0,
        hs: num(g.homeScore), as: num(g.awayScore), final: num(g.status) >= 2, simmed: simmed ?? null, gotw: Boolean(g.isGameOfTheWeek),
      });
    }
  }
  games.sort((a, b) => a.stage - b.stage || a.week - b.week || a.id - b.id);

  // ---------- teams ----------
  const standings = new Map(list(files, "standings.json").map((s: Any) => [s.teamId, s]));
  const pts = new Map<number, { pf: number; pa: number }>();
  for (const g of games) {
    if (g.stage !== 1 || g.week > 17 || !g.final) continue;
    for (const [t, f, a] of [[g.home, g.hs, g.as], [g.away, g.as, g.hs]]) {
      const e = pts.get(t) || { pf: 0, pa: 0 };
      e.pf += f; e.pa += a; pts.set(t, e);
    }
  }
  const teams: Team[] = list(files, "teams.json").map((t: Any) => {
    const s: Any = standings.get(t.teamId) || {};
    const p = pts.get(t.teamId) || { pf: 0, pa: 0 };
    return {
      id: t.teamId, abbr: t.abbrName, city: t.cityName, name: t.displayName, primary: hex(t.primaryColor), secondary: hex(t.secondaryColor),
      division: t.divName || s.divisionName || "", conference: s.conferenceName || (String(t.divName || "").split(" ")[0]),
      user: t.userName || "", ovr: num(t.ovrRating),
      cap: { room: num(s.capRoom), spent: num(s.capSpent), available: num(s.capAvailable) },
      rec: {
        w: num(s.totalWins), l: num(s.totalLosses), t: num(s.totalTies), pct: num(s.winPct),
        divW: num(s.divWins), divL: num(s.divLosses), divT: num(s.divTies),
        confW: num(s.confWins), confL: num(s.confLosses), confT: num(s.confTies),
        homeW: num(s.homeWins), homeL: num(s.homeLosses), homeT: num(s.homeTies),
        awayW: num(s.awayWins), awayL: num(s.awayLosses), awayT: num(s.awayTies),
        pf: p.pf, pa: p.pa, streak: signedByte(num(s.winLossStreak)), seed: num(s.seed), rank: num(s.rank),
      },
      ranks: {
        offYds: num(s.offTotalYdsRank), defYds: num(s.defTotalYdsRank), offPass: num(s.offPassYdsRank),
        offRush: num(s.offRushYdsRank), defPass: num(s.defPassYdsRank), defRush: num(s.defRushYdsRank),
      },
    };
  });

  // ---------- players ----------
  const TIER: Record<string, string> = { ABILITY_BRONZE: "Bronze", ABILITY_SILVER: "Silver", ABILITY_GOLD: "Gold", ABILITY_INVALID: "X-Factor" };
  const players: Player[] = [];
  const seen = new Set<number>();
  for (const name of Object.keys(files).filter((n) => n.startsWith("rosters/"))) {
    for (const p of list(files, name)) {
      if (seen.has(p.rosterId)) continue;
      seen.add(p.rosterId);
      const fa = Boolean(p.isFreeAgent);
      players.push({
        id: p.rosterId, team: fa ? 0 : p.teamId, first: p.firstName, last: p.lastName, pos: p.position, age: num(p.age),
        ovr: num(p.playerBestOvr), dev: (Math.max(0, Math.min(3, num(p.devTrait))) as 0 | 1 | 2 | 3), jersey: num(p.jerseyNum),
        yearsPro: num(p.yearsPro), college: p.college || "", height: num(p.height), weight: num(p.weight),
        draft: { round: num(p.draftRound), pick: num(p.draftPick), year: num(p.rookieYear) },
        ps: Boolean(p.isOnPracticeSquad), ir: Boolean(p.isOnIR), injury: num(p.injuryLength),
        contract: {
          length: num(p.contractLength), yearsLeft: num(p.contractYearsLeft), salary: num(p.contractSalary), bonus: num(p.contractBonus),
          capHit: Math.round(num(p.capHit) * 10000), releasePenalty: Math.round(num(p.capReleasePenalty) * 10000),
          releaseSavings: num(p.capReleaseNetSavings),
        },
        abilities: (p.signatureSlotList || [])
          .filter((s: Any) => !s.isEmpty && s.signatureAbility?.signatureTitle)
          .map((s: Any) => ({ title: s.signatureAbility.signatureTitle, tier: TIER[s.signatureAbility.rank] || "" })),
      });
    }
  }

  // ---------- stat lines ----------
  const lines = new Map<string, StatLine>();
  const line = (r: Any): StatLine => {
    const k = `${r.scheduleId}:${r.rosterId}`;
    let l = lines.get(k);
    if (!l) { l = { g: r.scheduleId, p: r.rosterId, t: r.teamId }; lines.set(k, l); }
    return l;
  };
  const weekFiles = (kind: string) => Object.keys(files).filter((n) => n.startsWith("weeks/") && n.endsWith(`/${kind}.json`));
  for (const f of weekFiles("passing")) for (const r of list(files, f)) {
    Object.assign(line(r), { pa: r.passAtt, pc: r.passComp, py: r.passYds, ptd: r.passTDs, pint: r.passInts, plng: r.passLongest, psk: r.passSacks });
  }
  for (const f of weekFiles("rushing")) for (const r of list(files, f)) {
    if (!r.rushAtt && !r.rushYds) continue;
    Object.assign(line(r), { ra: r.rushAtt, ry: r.rushYds, rtd: r.rushTDs, rlng: r.rushLongest, rfum: r.rushFum, rbt: r.rushBrokenTackles });
  }
  for (const f of weekFiles("receiving")) for (const r of list(files, f)) {
    if (!r.recCatches && !r.recYds && !r.recDrops) continue;
    Object.assign(line(r), { rc: r.recCatches, rcy: r.recYds, rctd: r.recTDs, rclng: r.recLongest, rcdrop: r.recDrops, rcyac: r.recYdsAfterCatch });
  }
  for (const f of weekFiles("defense")) for (const r of list(files, f)) {
    Object.assign(line(r), { tk: r.defTotalTackles, sk: r.defSacks, int: r.defInts, ff: r.defForcedFum, fr: r.defFumRec, dtd: r.defTDs, pd: r.defDeflections, sfty: r.defSafeties });
  }
  for (const f of weekFiles("kicking")) for (const r of list(files, f)) {
    Object.assign(line(r), { fga: r.fGAtt, fgm: r.fGMade, fglng: r.fGLongest, xpa: r.xPAtt, xpm: r.xPMade });
  }
  for (const f of weekFiles("punting")) for (const r of list(files, f)) {
    Object.assign(line(r), { pnt: r.puntAtt, pnty: r.puntYds, pntnet: r.puntNetYds, pnt20: r.puntsIn20, pntlng: r.puntLongest });
  }
  // Drop zero fields to keep the file small.
  for (const l of lines.values()) for (const k of Object.keys(l) as (keyof StatLine)[]) if (l[k] === 0 && !["g", "p", "t"].includes(k)) delete l[k];

  const teamGames: TeamGame[] = [];
  for (const f of weekFiles("teamstats")) for (const r of list(files, f)) {
    teamGames.push({
      g: r.scheduleId, t: r.teamId, yds: num(r.offTotalYds), passYds: num(r.offPassYds), rushYds: num(r.offRushYds),
      firstDowns: num(r.off1stDowns), third: [num(r.off3rdDownConv), num(r.off3rdDownAtt)], fourth: [num(r.off4thDownConv), num(r.off4thDownAtt)],
      redZone: [num(r.offRedZoneTDs), num(r.offRedZones)], turnovers: num(r.tOGiveaways), takeaways: num(r.tOTakeaways),
      sacks: num(r.defSacks), penalties: num(r.penalties), penaltyYds: num(r.penaltyYds),
    });
  }

  const stage = Math.min(si.seasonWeekType, 1);
  return {
    version: DATA_VERSION,
    builtAt: new Date().toISOString(),
    pulledAt: meta.pulledAt,
    season: {
      year: si.calendarYear, stage, week: si.seasonWeek,
      title: meta.currentWeekTitle || `Week ${si.seasonWeek + 1}`,
      secsSinceAdvance: typeof hub?.secsSinceLastAdvancedTime === "number" ? hub.secsSinceLastAdvancedTime : null,
    },
    weeks,
    teams,
    players,
    games,
    lines: [...lines.values()],
    teamGames,
  };
}

/**
 * EA stops returning a player's stat lines once he leaves the league, and never
 * returns preseason player stats after the preseason. Carry over everything the
 * previous build had for the same season, with this pull winning on conflicts.
 */
export function mergeHistory(prev: LeagueData | null, next: LeagueData): LeagueData {
  if (!prev || prev.season.year !== next.season.year) return next;
  const lineKey = (l: StatLine) => `${l.g}:${l.p}`;
  const lines = new Map(prev.lines.map((l) => [lineKey(l), l]));
  for (const l of next.lines) lines.set(lineKey(l), l);
  const tgKey = (t: TeamGame) => `${t.g}:${t.t}`;
  const teamGames = new Map(prev.teamGames.map((t) => [tgKey(t), t]));
  for (const t of next.teamGames) teamGames.set(tgKey(t), t);
  const games = new Map(prev.games.map((g) => [g.id, g]));
  for (const g of next.games) {
    const old = games.get(g.id);
    games.set(g.id, { ...g, simmed: g.simmed ?? old?.simmed ?? null });
  }
  const ids = new Set(next.players.map((p) => p.id));
  const needed = new Set([...lines.values()].map((l) => l.p));
  const gone = prev.players.filter((p) => !ids.has(p.id) && needed.has(p.id)).map((p) => ({ ...p, gone: true, team: 0 }));
  return {
    ...next,
    players: [...next.players, ...gone],
    games: [...games.values()].sort((a, b) => a.stage - b.stage || a.week - b.week || a.id - b.id),
    lines: [...lines.values()],
    teamGames: [...teamGames.values()],
  };
}
