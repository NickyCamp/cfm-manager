// Madden 27 formation catalog: every formation family and set, offense and defense.
// Set names and personnel come from the game's playbooks. Alignments are drawn by
// layout.ts from the set name, so each set needs only its personnel here.

export type Side = "O" | "D";

/** Offensive personnel: running backs, tight ends, wide receivers. */
export type OPers = [rb: number, te: number, wr: number];
/** Defensive personnel: down linemen, linebackers, cornerbacks, safeties. */
export type DPers = [dl: number, lb: number, cb: number, s: number];

export type OSet = { name: string; p: OPers };
export type DSet = { name: string; p: DPers };
export type OFamily = { id: string; name: string; sets: OSet[] };
export type DFamily = { id: string; name: string; sets: DSet[] };

// Compact source: "Set name|rb te wr". A bare name uses the family's default personnel.
function o(id: string, name: string, def: string, lines: string): OFamily {
  const parse = (s: string) => s.trim().split(/\s+/).map(Number) as OPers;
  return {
    id,
    name,
    sets: lines
      .trim()
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const [n, p] = l.split("|");
        return { name: n.trim(), p: parse(p ?? def) };
      }),
  };
}
function d(id: string, name: string, def: string, lines: string): DFamily {
  const parse = (s: string) => s.trim().split(/\s+/).map(Number) as DPers;
  return {
    id,
    name,
    sets: lines
      .trim()
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const [n, p] = l.split("|");
        return { name: n.trim(), p: parse(p ?? def) };
      }),
  };
}

export const OFFENSE: OFamily[] = [
  o("gun", "Gun", "1 1 3", `
    4WR Trips Strong|1 0 4
    5WR Flex Trey|0 1 4
    5WR Tight|0 0 5
    5WR Trio
    5WR Trips|0 0 5
    Ace|1 2 2
    Ace Offset|1 2 2
    Ace Slot|1 2 2
    Ace Slot Offset|1 2 2
    Box|1 0 4
    Box HB Strong
    Box Offset Wk
    Box Y Off
    Box Y Split
    Bunch
    Bunch HB Str
    Bunch Offset
    Bunch Offset Close
    Bunch Open|1 0 4
    Bunch Open Offset
    Bunch Open TE
    Bunch Quads
    Bunch Quads Close
    Bunch Quads Open
    Bunch Spread
    Bunch Spread Nasty
    Bunch Str Nasty
    Bunch Str Offset
    Bunch TE
    Bunch TE Str
    Bunch TE Wk
    Bunch Trio Open
    Bunch Wide
    Bunch Wide Nasty
    Bunch X Nasty
    Bunch Y-Flex
    Bunch Y-Trips
    Cluster
    Cluster HB Str
    Deuce|1 2 2
    Deuce Close|1 2 2
    Double Stack
    Double Wing|2 3 0
    Doubles
    Doubles Clamp Stack
    Doubles Flex
    Doubles Flex Wk Pats
    Doubles Flex Y Off Close
    Doubles HB Wk
    Doubles Hip
    Doubles Off Close Wk
    Doubles Offset
    Doubles Offset Wk
    Doubles Y Off
    Doubles Y Off Nasty
    Doubles Y Off Wk
    Doubles Y-Flex
    Doubles Y-Flex Offset
    Doubles Z Close
    Doubles Z Close Wk
    Duo Offset|2 0 3
    Duo Slot Open|2 0 3
    Empty Ace|1 2 2
    Empty Base
    Empty Base Flex
    Empty Base Trio
    Empty Bunch
    Empty Bunch Open
    Empty Bunch Tight
    Empty Bunch Wide
    Empty Bunch Y Flex
    Empty Chips
    Empty Chips Nasty
    Empty Chips Quads
    Empty Chips Tight
    Empty HB Wide
    Empty Quads|0 1 4
    Empty Sketch Stack
    Empty Strong Slot
    Empty Strong Slots
    Empty Trey
    Empty Trey Flex|0 1 4
    Empty Trey Stack
    Empty Triple Stack
    Empty Trips Speed
    Empty Y Slot
    Flanker Close|1 0 4
    Flanker Close Wk
    Flex Y Off
    Flex Y Off Close
    Flex Y Off Wk
    Gadget Package|3 1 1
    Go Go Twins Flex|2 1 2
    Monster
    Normal Flex Snug
    Normal Flex Wing
    Normal Off Close Wk
    Normal Wing Pats Close|1 2 2
    Normal Y Off
    Normal Y Off Close
    Normal Y Off Wk
    Open Flex
    Slot Left
    Slot Right
    Slot WR Backfield
    Split Close|2 0 3
    Split Close Pro|2 1 2
    Split Cowboy
    Split Flanker Close|2 0 3
    Split Offset|2 0 3
    Split Pro Near|2 1 2
    Split Pro Offset Wk|2 1 2
    Split Slot Offset|2 0 3
    Split Slot Open|2 0 3
    Split Twins|2 1 2
    Split Twins Offset|2 1 2
    Split Twins Offset Close|2 1 2
    Split Twins Stack|2 1 2
    Split U Off Close|2 2 1
    Split Wing Nasty|2 2 1
    Split WR Backfield
    Split Y Off|2 1 2
    Split Y Off Close
    Split Y-Flex|2 1 2
    Spread|1 0 4
    Spread 4WR|1 0 4
    Spread Dbl Flex
    Spread Dbl Flex Wk
    Spread Flex
    Spread Slots Close|1 0 4
    Spread Y-Flex
    Spread Y-Flex Wk
    Spread Y-Slot
    Spread Y-Slot Wk
    Stack HB Wk
    Stack Y Off
    Stack Y-Flex
    Tackle Over
    Tackle Over Trips
    Tight
    Tight Base Flex|2 1 2
    Tight Doubles
    Tight Flex
    Tight Flex Offset
    Tight Flex Wk
    Tight Offset TE
    Tight Open
    Tight Slot Flip
    Tight Slot Open
    Tight Slots
    Tight Slots HB Wk
    Tight Y Off
    Tight Y Off Wk
    Trey
    Trey 4WR|1 0 4
    Trey Offset
    Trey Open
    Trey Open HB Str
    Trey Open Offset
    Trey Y Iso
    Trey Y-Flex
    Trey Y-Flex Str
    Trio
    Trio 4WR Str|1 0 4
    Trio HB Wk
    Trio Offset
    Trio Offset Wk
    Trio Rt Open
    Trio Y-Flex
    Trips|1 0 4
    Trips HB Wk|1 0 4
    Trips Slots Close|1 0 4
    Trips TE
    Trips TE Flex
    Trips TE Flex Close Wk
    Trips TE Offset
    Trips TE Offset Wk
    Trips X Nasty
    Trips X Nasty Off Wk
    Trips Y Iso
    Trips Y Slot Str
    Trips Y-Flex
    U Off Stack|1 2 2
    U Off Trips|1 2 2
    U Off Trips Flex|1 2 2
    U Off Trips Wk|1 2 2
    Wide 5WR|0 0 5
    Wide Doubles Y Off Wk
    Wide Normal Y Off
    Wide Slot Left
    Wide Slot Right Wk
    Wide Trips|1 0 4
    Wide Trips HB Wk|1 0 4
    Wide Y Off Trips
    Wide Y Trips Wk
    Wing|1 2 2
    Wing Close Offset|1 2 2
    Wing Flex Offset|1 2 2
    Wing Flex Offset Wk|1 2 2
    Wing HB Wk Close|1 2 2
    Wing Pair|1 3 1
    Wing Slot Offset|1 2 2
    Wing Slot Offset Wk|1 2 2
    Wing Slot Wk|1 2 2
    Wing Stack|1 2 2
    Wing Stack Wk|1 2 2
    Wing Tight|1 3 1
    Wing Tight Flip|1 3 1
    Wing Tight Nasty|1 3 1
    Wing Tight Z|1 3 1
    Wing Trio
    Wing Trips Wk
    Wing Trips Wk Nasty
    Wing Trips Wk Nasty Mug
    Y Off Trio Close
    Y Off Trio Close Wk
    Y Off Trio Wk
    Y Off Trips
    Y Off Trips Nasty
    Y Off Trips Pats
    Y Off Trips Stack
    Y Off Trips Wk
    Y Trio Offset Wk
    Y Trips
    Y Trips 1 Slot
    Y Trips Offset
    Y Trips Offset Wk
    Y Trips Wk
  `),
  o("singleback", "Singleback", "1 1 3", `
    Ace|1 2 2
    Ace Close|1 2 2
    Ace Double Wing|2 3 0
    Ace Overload
    Ace Slot|1 2 2
    Bunch
    Bunch Ace|1 2 2
    Bunch Base|2 1 2
    Bunch TE
    Bunch X Nasty
    Deuce|1 2 2
    Deuce Close|1 2 2
    Deuce Close Tilt|2 1 2
    Doubles
    Doubles Flex
    Doubles North
    Doubles South
    Doubles Y Off
    Doubles Y Off Close
    Doubles Y Off Flex
    Doubles Y Open
    Doubles Y-Slot Close
    East|1 2 2
    East Tight|1 3 1
    F Wing Slot|2 1 2
    Spread|1 0 4
    Tight Doubles
    Tight Flex
    Tight Y Off
    Tight Y Off Flex
    Toad X Nasty
    Trey
    Trio
    Trips
    Trips Close
    Trips Open|1 0 4
    U Off|1 2 2
    U Off Close|1 2 2
    U Off Stack|1 2 2
    U Off Trio|1 2 2
    U Off Trips|1 2 2
    U Off Trips Cluster|1 2 2
    Wing|1 2 2
    Wing Close|1 2 2
    Wing Flex|1 2 2
    Wing Flex Close|1 2 2
    Wing Pair|1 3 1
    Wing Pair Heavy|1 2 2
    Wing Slot|1 2 2
    Wing Slot Over|1 2 2
    Wing Stack|1 2 2
    Wing Tight|1 3 1
    Wing Tight Left|1 3 1
    Wing Tight Nasty|1 3 1
    Wing Tight U|1 3 1
    Wing Tight Z|1 3 1
    Y Off Trio
    Y Off Trio Close
    Y Off Trips
    Y Trips
    Y Trips Close
    Y Trips Close Wing
    Y Trips TE Slot|1 2 2
  `),
  o("pistol", "Pistol", "1 1 3", `
    Ace|1 2 2
    Ace Double Wing|2 3 0
    Ace Slot|1 2 2
    Bunch
    Bunch TE
    Bunch X Nasty
    Deuce|1 2 2
    Deuce Close|1 2 2
    Doubles
    Doubles Flex Hip
    Doubles Hip
    Doubles Y Off
    Doubles Y Off Stack
    East Tight|1 3 1
    Full House|3 0 2
    Full House Base|2 1 2
    Full House Over Close|2 1 2
    Full House Pro|2 1 2
    Full House TE|2 2 1
    Full Panther|3 1 1
    Open Flex
    Open Flex Close
    Philly
    Spread|1 0 4
    Spread Y Slot
    Strong|2 1 2
    Strong Slot|2 1 2
    Strong Slot Close|2 1 2
    Strong Slot Open|2 0 3
    Strong Y Off Close|2 1 2
    Tight Slots
    Tight Y Off Flex
    Trips
    Trips Left Open|1 0 4
    Trips Open|1 0 4
    Trips Y Over
    U Off|1 2 2
    U Off Stack|1 2 2
    U Off Trips|1 2 2
    Weak|2 1 2
    Weak I Wing|2 2 1
    Weak Slot|2 1 2
    Weak Slot Open|2 0 3
    Wing|1 2 2
    Wing Close|1 2 2
    Wing Flex|1 2 2
    Wing Flex Close|1 2 2
    Wing Slot|1 2 2
    Wing Tight Z|1 3 1
    Y Off Trips
    Y Trips
  `),
  o("iform", "I Form", "2 1 2", `
    Close
    Close Flex
    H Pro
    H Tight|2 2 1
    H Wing|2 2 1
    Hulk|2 2 1
    Pro
    Slot
    Slot Close
    Slot Flex
    Slot Open|2 0 3
    Slot Stack
    Tight|2 2 1
    Wing|2 2 1
    Wing Over|2 2 1
    Y Off
    Y Off Close
  `),
  o("strongi", "Strong I", "2 1 2", `
    Jumbo|2 3 0
    H Tight Close|2 2 1
    H Wing|2 2 1
    Tight|2 2 1
    Wing|2 2 1
    Wing Close|2 2 1
    Close
    Close Flex
    H Close Off
    H Slot
    Pro
    Slot
    Slot Flex
    Twins Over
    Y Off Close
    Y Open Flex
    Z Close
  `),
  o("weaki", "Weak I", "2 1 2", `
    H U Off|2 2 1
    H Wing|2 2 1
    Wing|2 2 1
    Close
    Close Flex
    H Close Off
    Pro
    Slot
    Slot Close
    Slot Flex
    Z Close
    3WR Flex|2 0 3
    Slot Open|2 0 3
  `),
  o("poweri", "Power I", "3 1 1", `
    Strong|3 1 1
    Tight|3 2 0
  `),
  o("fullhouse", "Full House", "2 1 2", `
    Normal
    Normal Wide
    Tight|3 2 0
  `),
  o("marylandi", "Maryland I", "3 2 0", `
    Close|3 1 1
    Heavy|3 2 0
    Tight Close|3 0 2
  `),
  o("splitbacks", "Split Backs", "2 1 2", `
    Offset Wing Close
    Pro
    Slot
    3WR|2 0 3
    Pro Slot|2 0 3
  `),
  o("near", "Near", "2 1 2", `
    Jumbo|2 3 0
    Close
    Close Flex
    Pro
    Y Left Slot
  `),
  o("far", "Far", "2 1 2", `
    Pro
    Slot
    Tight Slot
  `),
  o("wishbone", "Wishbone", "3 2 0", `
    Tight
  `),
  o("flexbone", "Flexbone", "3 0 2", `
    Close
    Normal
    Tight|3 2 0
    Trio Right|2 0 3
  `),
  o("splitt", "Split T", "3 2 0", `
    Tight
  `),
  o("wildcat", "Wildcat", "2 1 2", `
    Ace Y Off|1 1 3
    Pro
    Slot Flex
    Trips Over|2 2 1
    Unbalanced|2 2 1
  `),
  o("goalline", "Goal Line", "2 3 0", `
    Normal|2 3 0
    Sneak|3 2 0
  `),
  o("hailmary", "Hail Mary", "1 1 3", `
    Spread
    Trio
  `),
];

export const DEFENSE: DFamily[] = [
  d("43", "4-3", "4 3 2 2", `
    Odd Leo
    Tite Leo
    Even 6-1
    Odd
    Over
    Over Solid
    Over Walk
    Over Wide
    Under
  `),
  d("34", "3-4", "5 2 2 2", `
    Bear
    Bear 46
    Cub
    Even
    Grizzly
    Odd
    Over
    Over Ed
    Over Solid
    Predator|3 4 2 2
    Tite
    Tite 5t
    Tite Grizzly
    Under
    Under 4t
  `),
  d("44", "4-4", "4 4 2 1", `
    Split
  `),
  d("46", "46", "4 3 2 2", `
    Bear
    Bear Under
    Normal
  `),
  d("52", "5-2", "5 2 2 2", `
    Normal
  `),
  d("25", "2-5", "4 3 2 2", `
    Over Wide
  `),
  d("nickel", "Nickel", "4 2 3 2", `
    2-4|2 4 3 2
    2-4 Dbl Mug|2 4 3 2
    2-4 Load|2 4 3 2
    2-4 Load Dbl Mug|2 4 3 2
    2-4 Load Mug|2 4 3 2
    2-4 Odd|2 4 3 2
    2-4 Odd Dbl Mug|2 4 3 2
    2-4 Single Mug|2 4 3 2
    2-4 Swap Dbl Mug|2 4 3 2
    2-4 Wide|2 4 3 2
    3-3|3 3 3 2
    3-3 Cub|3 3 3 2
    3-3 Dbl Mug|3 3 3 2
    3-3 Load Dbl Mug|3 3 3 2
    3-3 Load Mug|3 3 3 2
    3-3 Odd|3 3 3 2
    3-3 Over|3 3 3 2
    3-3 Over Jack|3 3 3 2
    3-3 Single Mug|3 3 3 2
    3-3 Swap Dbl Mug|3 3 3 2
    3-3 Wide Jack|3 3 3 2
    3-3 Will|3 3 3 2
    Double Mug
    Load
    Load Dbl Mug
    Load Mug
    Over
    Single Mug
    Swap Dbl Mug
    Triple
    Wide
  `),
  d("425", "4-2-5", "4 2 2 3", `
    3 High
    Even
    Over G
    Over Wide
    Under
  `),
  d("335", "3-3-5", "3 3 2 3", `
    3 High Over
    Over Flex
    Over Wide
    Penny|5 1 2 3
    Penny 3 High|5 1 2 3
  `),
  d("245", "2-4-5", "2 4 3 2", `
    Over Wide
  `),
  d("dime", "Dime", "4 1 4 2", `
    1-4 Dbl Mug|1 4 3 3
    1-4-6|1 4 3 3
    2-3 Odd|2 3 3 3
    2-3 Odd Jack|2 3 3 3
    2-3 Single Mug|2 3 4 2
    2-3-6|2 3 3 3
    3-2 Odd|3 2 4 2
    3-2 Rush|3 2 4 2
    3-2 Swap Dbl Mug|3 2 3 3
    Load Weak
    Normal
    Single Mug
  `),
  d("dollar", "Dollar", "3 2 3 3", `
    3-2
    Sugar 3-2
  `),
  d("quarter", "Quarter", "3 1 4 3", `
    1-3-7|1 3 4 3
    Normal
    Over Load|1 3 4 3
  `),
  d("goalline", "Goal Line", "6 2 2 1", `
    6-2
    Pinch
    5-3|5 3 2 1
  `),
  d("prevent", "Prevent", "3 1 4 3", `
    3 Deep
  `),
];

export function findO(fam: string, set: string) {
  const f = OFFENSE.find((x) => x.id === fam) ?? OFFENSE[0];
  return { fam: f, set: f.sets.find((s) => s.name === set) ?? f.sets[0] };
}
export function findD(fam: string, set: string) {
  const f = DEFENSE.find((x) => x.id === fam) ?? DEFENSE[0];
  return { fam: f, set: f.sets.find((s) => s.name === set) ?? f.sets[0] };
}

export const SET_COUNT = {
  O: OFFENSE.reduce((n, f) => n + f.sets.length, 0),
  D: DEFENSE.reduce((n, f) => n + f.sets.length, 0),
};
