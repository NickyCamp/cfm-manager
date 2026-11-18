// Small helpers shared by /funfact's fact builders (funfacts.ts, teamRoasts.ts).
import { createHash, randomInt } from "node:crypto";

/** One fact. `key` names the template it came from, so /funfact can avoid repeating the same
 *  fact (in any wording) for a while; facts without a key are matched by their text. */
export type Fact = { text: string; weight: number; key?: string };

export const n = (v: number) => Math.round(v).toLocaleString("en-US");
export const every = (v: number) => (v >= 10 ? n(v) : v.toFixed(1).replace(/\.0$/, ""));
export const money = (v: number) => (v >= 1e6 ? `$${(v / 1e6).toFixed(v >= 1e7 ? 1 : 2)}M` : v >= 1e3 ? `$${n(v / 1e3)}K` : `$${n(v)}`);
export const pct = (v: number) => `${Math.round(v)}%`;
export const plural = (k: number, word: string, many = `${word}s`) => `${n(k)} ${k === 1 ? word : many}`;
/** "the Seahawks" → "the Seahawks'", "Ward" → "Ward's". */
export const poss = (name: string) => (name.endsWith("s") ? `${name}'` : `${name}'s`);
export const ord = (k: number) => { const s = ["th", "st", "nd", "rd"], v = k % 100; return k + (s[(v - 20) % 10] || s[v] || s[0]); };
/** "the most" / "the 3rd-most", "the highest" / "the 4th-highest". */
export const nth = (k: number, word: string) => (k === 1 ? `the ${word}` : `the ${ord(k)}-${word}`);
/** One of several wordings, at random. */
export const pick = <T>(xs: readonly T[]): T => xs[randomInt(xs.length)];
/** Discord markdown would eat underscores/asterisks in gamertags. */
export const esc = (s: string) => s.replace(/([\\*_~`|>])/g, "\\$1");

/** Closing jabs, tacked onto some roasts at random so the same stat doesn't always read the same. */
const TAILS = [
  // Nick, 2026-11-18: "no low hanging fruits", so no generic "Yikes."/"Brutal." filler.
  "Somebody check on the fans.", "The group chat has questions.", "Embarrassing for the whole building.",
  "Draft position is looking strong though.", "Even the mascot wants a trade.", "Someone tell the owner.",
  "Season tickets are going cheap.", "The film room must be a crime scene.", "Ownership should be asking questions.",
  "Uninstall the game.", "Delete the franchise file.", "Their fans deserve better. Actually, maybe not.",
  "Somebody turn the difficulty down for them.", "Rookie mode might be more their speed.", "Hide the controller from this man.",
  "The tape should be used as evidence.", "Not even the CPU wants to play them.",
  // "even more violent"
  "Call the coroner.", "Bury the film. Then bury the team.", "They'll need dental records to identify the offense.",
  "Cremate the playbook.", "Next of kin has been notified.", "Crime scene tape around the end zone.",
  "The Geneva Convention has questions.", "Closed-casket performance.", "Somebody chalk-outline the 50-yard line.",
  "Time of death: kickoff.", "The ambulance is already idling outside.", "Football was committed against them.",
  "Witnesses are still in therapy.", "Put the whole roster on a milk carton.", "Euthanize the season.",
  "Hall of Shame, first ballot.", "Mercy rule should be in the CBA.",
  // Real world / pop culture ("GTA 6, OJ Simpson, NFL players committing crimes… crazy headlines").
  "Rockstar delayed GTA 6 twice for polish. This team skipped the polish and shipped anyway.",
  "Johnnie Cochran couldn't get this acquitted.", "The Bronco chase averaged 35 mph and still ran a better two-minute drill.",
  "The butt fumble was at least a team effort.", "Plaxico shot himself in a nightclub and still had a better week.",
  "The 2006 Bengals had nine arrests in nine months and a better culture than this.",
  "Congress passes more bills than this team completes passes.", "This drive got filibustered.",
  "Sam Bankman-Fried kept cleaner books than this cap sheet.", "FTX had better risk management.",
  "Antonio Brown took his jersey off mid-game and still left with more dignity.",
  "Dan Orlovsky ran out the back of his own end zone and still had more situational awareness.",
  "Somewhere Leon Lett is finally off the hook.", "Deflategate got a 4-game suspension. This deserves life.",
  "If the glove doesn't fit, you must acquit. Nothing about this fits.", "Tariffs on this offense would be an act of mercy.",
];
// Openers, now and then, for the same reason.
const HEADS = [
  "Autopsy report:", "BREAKING:", "Police report:", "Coroner's note:", "Exhibit A:", "Witness statement:",
  "Crime scene update:", "Obituary:", "For the record:", "Evidence #47:", "Breaking news from the morgue:",
];
export const tail = (text: string, chance = 0.6) => {
  let t = text;
  if (randomInt(1000) < 150) t = `${pick(HEADS)} ${t}`;
  if (randomInt(1000) < chance * 1000) t = `${t} ${pick(TAILS)}`;
  return t;
};

/** Short, stable id for a fact, for the recently-shown list. */
export const factId = (f: Fact) => createHash("sha1").update(f.key || f.text).digest("base64url").slice(0, 7);
