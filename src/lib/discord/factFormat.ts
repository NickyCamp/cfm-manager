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
  // More, so the league goes longer between repeats.
  "The film is being studied by the FBI.", "Scientists are studying this as a new form of losing.",
  "The Hall of Fame wants the tape for its 'what not to do' wing.", "Even the scoreboard looked away.",
  "This should come with a parental advisory.", "The league is looking into whether this counts as football.",
  "Their highlight reel is just the coin toss.", "Insurance companies list this team as a natural disaster.",
  "The turf filed a noise complaint.", "Somewhere a high school coach is taking notes on what not to do.",
  "The stadium lights flicker out of shame.", "The team chaplain has started drinking.",
  "A local news anchor cried reading this on air.", "Even the waterboy asked for a trade.",
  "The playbook was found in a dumpster behind the stadium.", "NASA could see this disaster from orbit.",
  "Ticket scalpers are paying people to take them.", "The refs felt bad and stopped throwing flags out of pity.",
  "History will not be kind. Neither are we.", "The tape has been sealed by court order.",
  "Their fight song is just someone sighing.", "This aged like milk in a hot car.",
  "This is why the CPU has trust issues.", "Natural selection is coming for this roster.",
  "The bye week is their best performance of the year.", "Even the Lions of 2008 are laughing.",
];
// Openers, now and then, for the same reason.
const HEADS = [
  "Autopsy report:", "BREAKING:", "Police report:", "Coroner's note:", "Exhibit A:", "Witness statement:",
  "Crime scene update:", "Obituary:", "For the record:", "Evidence #47:", "Breaking news from the morgue:",
];
// Quips are placed as tokens when facts are built and filled in by resolveQuips once a fact is picked,
// so the bot can skip quips the league saw recently (Nick, 2026-11-18: saw "The Geneva Convention has
// questions" several times quickly).
const T_HEAD = "\u0001H\u0001", T_TAIL = "\u0001T\u0001", T_USER = "\u0001U\u0001";
export const tail = (text: string, chance = 0.4) => {
  let t = text;
  if (randomInt(1000) < 150) t = `${T_HEAD} ${t}`;
  if (randomInt(1000) < chance * 1000) t = `${t} ${T_TAIL}`;
  return t;
};
/** A closer aimed at the user who runs the team (userRoasts.ts). */
export const userJab = (text: string) => `${text} ${T_USER}`;

/** Closers aimed at the user, not the team. */
const AT_USER = [
  "His PS5 should be seized as evidence.", "His controller has filed for a restraining order.",
  "His thumbs should be tried at The Hague.", "Somebody unplug his console before he hurts anyone else.",
  "Revoke his EA account.", "He should be legally barred from holding a controller.",
  "His Madden license has been suspended indefinitely.", "Throw the controller in a river and him after it.",
  "The franchise should press charges.", "Ban him from the group chat until further notice.",
  "His teammates are drafting a petition to have him removed as coach.", "Every fan in that stadium wants a refund and an apology.",
  "Rookie difficulty has a waiting list and he's on it.", "Uninstall Madden, then uninstall yourself from the league.",
  "His mom still thinks he's good at this. Somebody tell her.", "EA should send him a cease and desist.",
  "Sony is considering a recall on his specific PS5.", "His controller drift is the best player on the team.",
  "The CPU on Rookie would run him out of the building.", "His trophy case is just a participation ribbon and a restraining order.",
  "He should have to wear a bell so people know he's coming.", "Somebody check if he's even plugged the controller in.",
];

/** Recently used quips per kind, league-wide (newest last); the kinds are h(eads), t(ails), u(ser). */
export type QuipMemory = { h?: string[]; t?: string[]; u?: string[] };
const QUIP_KEEP = { h: 7, t: 45, u: 14 } as const;
const qid = (q: string) => createHash("sha1").update(q).digest("base64url").slice(0, 5);
type Kind = "h" | "t" | "u";
/** Fill a fact's quip tokens, skipping quips in `mem`; returns the text and the ids used. */
export function resolveQuips(text: string, mem: QuipMemory = {}): { text: string; used: QuipMemory } {
  const used: QuipMemory = {};
  const fill = (kind: Kind, pool: readonly string[]) => {
    const seen = new Set(Array.isArray(mem[kind]) ? mem[kind] : []);
    const fresh = pool.filter((q) => !seen.has(qid(q)));
    const q = pick(fresh.length ? fresh : pool);
    used[kind] = [qid(q)];
    return q;
  };
  let out = text;
  if (out.includes(T_HEAD)) out = out.replace(T_HEAD, fill("h", HEADS));
  if (out.includes(T_TAIL)) out = out.replace(T_TAIL, fill("t", TAILS));
  if (out.includes(T_USER)) out = out.replace(T_USER, fill("u", AT_USER));
  return { text: out, used };
}
/** Add the ids `used` to the memory (newest last, trimmed per kind). */
export function mergeQuips(mem: QuipMemory | undefined, used: QuipMemory): QuipMemory {
  const next: QuipMemory = {};
  for (const kind of ["h", "t", "u"] as Kind[]) {
    const cur = Array.isArray(mem?.[kind]) ? mem![kind]! : [];
    const add = used[kind] || [];
    next[kind] = [...cur.filter((x) => !add.includes(x)), ...add].slice(-QUIP_KEEP[kind]);
  }
  return next;
}

/** Short, stable id for a fact, for the recently-shown list. */
export const factId = (f: Fact) => createHash("sha1").update(f.key || f.text).digest("base64url").slice(0, 7);
