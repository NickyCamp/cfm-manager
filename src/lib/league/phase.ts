// Where a league is in its season, from EA's league hub seasonInfo.
//
// EA's seasonWeekType: 0 preseason, 1 regular season, 2 Wild Card, 3 Divisional,
// 4 Conference, 5 Pro Bowl, 6 Super Bowl (seasonWeek 18-22 in the playoffs, so the
// playoff types run seasonWeek - 16). After the Super Bowl the type moves past 6 and
// seasonWeek restarts at 0 for each offseason step, which used to be read as
// "regular season Week N" (NCL, 2026-11-15: showed "2027 Week 2" after the Super Bowl).
//
// Our data stages: 0 preseason, 1 regular season + playoffs, 2 offseason (no games).

export const OFFSEASON_STAGE = 2;

type SeasonInfo = { seasonWeekType?: unknown; seasonWeek?: unknown };
type HubWeek = { stageIndex?: unknown; weekIndex?: unknown; weekTitle?: unknown };

export function eaPhase(si: SeasonInfo | null | undefined, hubWeeks: HubWeek[] = []) {
  const type = Number(si?.seasonWeekType ?? 0);
  const week = Number(si?.seasonWeek ?? 0);
  const offseason = type >= 7 || (type >= 2 && week < 18);
  if (offseason) {
    // Use EA's own name for the offseason step if the hub lists one.
    const own = hubWeeks.find((w) => Number(w.stageIndex) === type && Number(w.weekIndex) === week);
    const title = typeof own?.weekTitle === "string" && own.weekTitle ? own.weekTitle : "Offseason";
    return { stage: OFFSEASON_STAGE, week, title, offseason: true, type };
  }
  const stage = Math.min(type, 1);
  const own = hubWeeks.find((w) => Number(w.stageIndex) === stage && Number(w.weekIndex) === week);
  const title = typeof own?.weekTitle === "string" && own.weekTitle ? own.weekTitle
    : stage === 0 ? `Preseason Week ${week + 1}` : `Week ${week + 1}`;
  return { stage, week, title, offseason: false, type };
}
