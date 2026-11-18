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
  "Thoughts and prayers.", "Somebody check on the fans.", "Brutal.", "Yikes.", "Sell the team.",
  "The group chat has questions.", "Not great, Bob.", "Fire everybody.", "Embarrassing for the whole building.",
  "Sit with that for a minute.", "Draft position is looking strong though.", "Even the mascot wants a trade.",
  "Concerning.", "That's a choice.", "Someone tell the owner.", "Please stop.", "Tough look.",
  "Season tickets are going cheap.", "The film room must be a crime scene.", "Pathetic, honestly.",
  "Ownership should be asking questions.", "It's giving rebuild.", "Unwatchable football.",
  "Uninstall the game.", "Delete the franchise file.", "Absolute clown show.", "A disgrace to the sport.",
  "Their fans deserve better. Actually, maybe not.", "Put this team in a museum of failures.",
  "Somebody turn the difficulty down for them.", "This is why nobody respects them.",
  "Genuinely sad to look at.", "Rookie mode might be more their speed.", "Hide the controller from this man.",
  "The tape should be used as evidence.", "Get this team off my screen.", "Not even the CPU wants to play them.",
];
export const tail = (text: string, chance = 0.6) => (randomInt(1000) < chance * 1000 ? `${text} ${pick(TAILS)}` : text);

/** Short, stable id for a fact, for the recently-shown list. */
export const factId = (f: Fact) => createHash("sha1").update(f.key || f.text).digest("base64url").slice(0, 7);
