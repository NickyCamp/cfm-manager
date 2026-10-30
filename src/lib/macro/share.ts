// A macro lives entirely in the page address (after the #), so sharing needs no
// account and no server: copy the link, send it, it opens the same picture.

export type Step = {
  /** Player id, or "*" for a team-wide adjustment. */
  p: string;
  /** Assignment key, or for "*" steps the adjustment category. */
  k: string;
  /** Zone/gap spot id, or the adjustment option for "*" steps. */
  s?: string;
  /** Man coverage target (an opponent player id). */
  t?: string;
};

export type MacroState = {
  v: 1;
  side: "O" | "D";
  f: string; // formation family
  s: string; // set
  of?: string; // opponent family (shown faded)
  os?: string; // opponent set
  fl?: 1; // flipped
  st: Step[];
  mv: Record<string, [number, number]>; // dragged players
  t?: string; // title
  n?: string; // notes
};

export const DEFAULT_STATE: MacroState = {
  v: 1,
  side: "D",
  f: "3-4",
  s: "Over Solid",
  of: "gun",
  os: "4WR Trips Strong",
  st: [],
  mv: {},
};

function toB64Url(str: string) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromB64Url(b64: string) {
  const bin = atob(b64.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

const round = (n: number) => Math.round(n * 10) / 10;

export function encodeState(st: MacroState): string {
  const slim: MacroState = { ...st, mv: Object.fromEntries(Object.entries(st.mv).map(([k, [x, y]]) => [k, [round(x), round(y)]])) };
  if (!slim.t) delete slim.t;
  if (!slim.n) delete slim.n;
  if (!slim.fl) delete slim.fl;
  if (!slim.of) { delete slim.of; delete slim.os; }
  return toB64Url(JSON.stringify(slim));
}

export function decodeState(hash: string): MacroState | null {
  const m = hash.match(/[#&]m=([A-Za-z0-9_-]+)/);
  if (!m) return null;
  try {
    const raw = JSON.parse(fromB64Url(m[1]));
    if (raw?.v !== 1 || (raw.side !== "O" && raw.side !== "D") || typeof raw.f !== "string") return null;
    return {
      v: 1,
      side: raw.side,
      f: raw.f,
      s: String(raw.s ?? ""),
      of: typeof raw.of === "string" ? raw.of : undefined,
      os: typeof raw.os === "string" ? raw.os : undefined,
      fl: raw.fl ? 1 : undefined,
      st: Array.isArray(raw.st) ? raw.st.filter((x: Step) => x && typeof x.p === "string" && typeof x.k === "string").slice(0, 200) : [],
      mv: raw.mv && typeof raw.mv === "object" ? raw.mv : {},
      t: typeof raw.t === "string" ? raw.t.slice(0, 80) : undefined,
      n: typeof raw.n === "string" ? raw.n.slice(0, 600) : undefined,
    };
  } catch {
    return null;
  }
}
