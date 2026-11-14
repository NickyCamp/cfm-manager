// Kickoff times for game markets: which games can get one, and reading times
// people type in chat ("9pm", "tomorrow 8:30pm", "sat 7pm", "in 45m", "now").
import type { Game, LeagueData } from "@/lib/league/types";

/** Why a game can't get a kickoff time, or "" if it can. */
export function kickoffProblem(d: LeagueData, g: Game | undefined) {
  if (!g || !g.home || !g.away) return "That game isn't on the schedule.";
  if (g.stage !== d.season.stage || g.week !== d.season.week) return "Only this week's games can get a kickoff time.";
  if (g.final) return "That game is already final.";
  return "";
}

/** The current week's game for a team. */
export function teamGameThisWeek(d: LeagueData, teamId: number) {
  return d.games.find((g) => g.stage === d.season.stage && g.week === d.season.week && (g.home === teamId || g.away === teamId));
}

export const TIMEZONES: Record<string, string> = { ET: "America/New_York", CT: "America/Chicago", MT: "America/Denver", PT: "America/Los_Angeles" };
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const MAX_AHEAD = 14 * 86400_000;

function parts(t: number, tz: string) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", weekday: "short", hourCycle: "h23" });
  const p = Object.fromEntries(f.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, min: +p.minute, wd: DAYS.indexOf(String(p.weekday).toLowerCase().slice(0, 3)) };
}
/** UTC time for a wall-clock time in a time zone. */
function zoned(y: number, m: number, d: number, h: number, min: number, tz: string) {
  const guess = Date.UTC(y, m - 1, d, h, min);
  const p = parts(guess, tz);
  const offset = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min) - guess;
  const t = guess - offset;
  const p2 = parts(t, tz); // fix DST edges
  return t - (Date.UTC(p2.y, p2.m - 1, p2.d, p2.h, p2.min) - guess);
}

/** Reads a typed time. Returns null when it can't, or when it's more than 2 weeks out / in the past. */
export function parseKickoff(raw: string, tz = "America/New_York", now = Date.now()): Date | null {
  const s = raw.trim().toLowerCase().replace(/\s+/g, " ").replace(/\./g, "");
  if (!s) return null;
  if (s === "now") return new Date(now);
  const rel = /^in (?:(\d+) ?h(?:ours?|rs?)?)? ?(?:(\d+) ?m(?:in(?:ute)?s?)?)?$/.exec(s);
  if (rel && (rel[1] || rel[2])) {
    const t = now + (Number(rel[1] || 0) * 60 + Number(rel[2] || 0)) * 60_000;
    return t - now <= MAX_AHEAD ? new Date(t) : null;
  }
  const m = /^(?:(today|tonight|tomorrow|tmrw|sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)[a-z]*,? )?(?:at )?(\d{1,2})(?::(\d{2}))? ?(am|pm|a|p)?$/.exec(s);
  if (!m) return null;
  let h = Number(m[2]); const min = Number(m[3] || 0);
  const ap = m[4]?.[0];
  if (min > 59 || h > 23 || (ap && (h < 1 || h > 12))) return null;
  if (ap === "p" && h < 12) h += 12;
  if (ap === "a" && h === 12) h = 0;
  // no am/pm on a 1–11 o'clock time ("9", "9:30"): read it as evening; the reply shows the time so it can be fixed
  if (!ap && h >= 1 && h <= 11) h += 12;
  const today = parts(now, tz);
  const at = (addDays: number) => {
    const base = new Date(Date.UTC(today.y, today.m - 1, today.d + addDays));
    return zoned(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), h, min, tz);
  };
  const day = m[1];
  let t: number;
  if (!day || day === "today" || day === "tonight") {
    t = at(0);
    if (!day && t < now - 5 * 60_000) t = at(1); // "9pm" after 9pm means tomorrow
  } else if (day.startsWith("tom") || day === "tmrw") t = at(1);
  else {
    const want = DAYS.indexOf(day.slice(0, 3));
    let add = (want - today.wd + 7) % 7;
    if (add === 0 && at(0) < now) add = 7;
    t = at(add);
  }
  if (t < now - 5 * 60_000 || t - now > MAX_AHEAD) return null;
  return new Date(Math.max(t, now));
}

/** Reads a typed time that has already happened (an admin verifying when a game really kicked off):
 *  "9pm" = the latest 9pm before now, "sat 7pm" = last Saturday, "yesterday 8:30pm", "2h ago".
 *  Within the last 3 weeks. */
export function parseKickoffPast(raw: string, tz = "America/New_York", now = Date.now()): Date | null {
  const s = raw.trim().toLowerCase().replace(/\s+/g, " ").replace(/\./g, "");
  if (!s) return null;
  const ago = /^(?:(\d+) ?h(?:ours?|rs?)?)? ?(?:(\d+) ?m(?:in(?:ute)?s?)?)? ago$/.exec(s);
  if (ago && (ago[1] || ago[2])) return new Date(now - (Number(ago[1] || 0) * 60 + Number(ago[2] || 0)) * 60_000);
  const m = /^(?:(today|tonight|yesterday|sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)[a-z]*,? )?(?:at )?(\d{1,2})(?::(\d{2}))? ?(am|pm|a|p)?$/.exec(s);
  if (!m) return null;
  let h = Number(m[2]); const min = Number(m[3] || 0);
  const ap = m[4]?.[0];
  if (min > 59 || h > 23 || (ap && (h < 1 || h > 12))) return null;
  if (ap === "p" && h < 12) h += 12;
  if (ap === "a" && h === 12) h = 0;
  if (!ap && h >= 1 && h <= 11) h += 12;
  const today = parts(now, tz);
  const at = (addDays: number) => {
    const base = new Date(Date.UTC(today.y, today.m - 1, today.d + addDays));
    return zoned(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), h, min, tz);
  };
  const day = m[1];
  let t: number;
  if (!day) { t = at(0); if (t > now) t = at(-1); }
  else if (day === "today" || day === "tonight") t = at(0);
  else if (day === "yesterday") t = at(-1);
  else {
    const want = DAYS.indexOf(day.slice(0, 3));
    let back = (today.wd - want + 7) % 7;
    if (back === 0 && at(0) > now) back = 7;
    t = at(-back);
  }
  if (t > now + 60_000 || now - t > 21 * 86400_000) return null;
  return new Date(t);
}
