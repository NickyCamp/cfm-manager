// Card builder (Nick's request, 2026-11-13): which built-in layers a player's card shows.
// Saved per card by whoever can edit that card's art (team owner or commissioner) and seen by
// everyone, on the site and in Discord. Default is everything on; a card with nothing saved
// looks exactly like before. Client-safe (no server imports).

export const CARD_LAYERS = [
  { key: "frame", label: "Frame", hint: "Bronze / silver / gold / ruby border" },
  { key: "ovr", label: "Overall + position", hint: "Rating and position art" },
  { key: "team", label: "Team logo", hint: "Logo or team badge" },
  { key: "abilities", label: "Abilities", hint: "Ability badges" },
  { key: "name", label: "Name", hint: "First / last name and rookie ribbon" },
  { key: "shade", label: "Dark shading", hint: "Darkens the edges so text reads" },
  { key: "holo", label: "Holo shine", hint: "Animated foil on the site" },
] as const;

export type CardLayerKey = (typeof CARD_LAYERS)[number]["key"];

/** Fonts a card can use for the name and for the overall/position. Files: public/fonts/*.woff2 (site), assets/fonts/*.woff (Discord). */
export const CARD_FONTS = [
  { key: "barlow", label: "Barlow", family: "Barlow Condensed", weight: 800 },
  { key: "bebas", label: "Bebas", family: "Bebas Neue", weight: 400 },
  { key: "anton", label: "Anton", family: "Anton", weight: 400 },
  { key: "oswald", label: "Oswald", family: "Oswald", weight: 700 },
  { key: "teko", label: "Teko", family: "Teko", weight: 600 },
  { key: "graduate", label: "Varsity", family: "Graduate", weight: 400 },
  { key: "cinzel", label: "Cinzel", family: "Cinzel", weight: 900 },
] as const;
export type FontKey = (typeof CARD_FONTS)[number]["key"];
export const cardFont = (k: string) => CARD_FONTS.find((f) => f.key === k) ?? CARD_FONTS[0];

/** Stock borders anyone can pick (Nick's 16-style pack, 2026-11-13): public/frames/stock/<key>.webp (site) and .png (Discord),
 *  thinned 25% like the built-in frames. inset = where the card sits inside that border (% of card width), measured per frame. */
export const STOCK_FRAMES = [
  { key: "bronze-metal", label: "Bronze", inset: 5.1 },
  { key: "silver-metal", label: "Silver", inset: 6.4 },
  { key: "gold-metal", label: "Gold", inset: 4.7 },
  { key: "ruby-gemstone", label: "Ruby", inset: 5.6 },
  { key: "emerald-gemstone", label: "Emerald", inset: 5.8 },
  { key: "sapphire-gemstone", label: "Sapphire", inset: 5.8 },
  { key: "amethyst-crystal", label: "Amethyst", inset: 9.5 },
  { key: "golden-amber", label: "Amber", inset: 9.6 },
  { key: "prismatic-diamond", label: "Diamond", inset: 6.7 },
  { key: "black-opal", label: "Black Opal", inset: 7.0 },
  { key: "crimson-obsidian", label: "Crimson Obsidian", inset: 6.6 },
  { key: "icy-aqua-crystal", label: "Icy Aqua", inset: 6.6 },
  { key: "holographic-prism", label: "Holo Prism", inset: 4.7 },
  { key: "neon-cyan-magenta", label: "Cyan / Magenta", inset: 4.6 },
  { key: "teal-violet-neon", label: "Teal / Violet", inset: 6.3 },
  { key: "sunset-gradient", label: "Sunset", inset: 5.0 },
] as const;
export const stockFrame = (k: string) => STOCK_FRAMES.find((f) => f.key === k);
export const stockFramePath = (k: string, ext: "webp" | "png" = "webp") => `/frames/stock/${k}.${ext}`;

export type CardLayout = Record<CardLayerKey, boolean> & {
  stockFrame: string;   // a stock border key (STOCK_FRAMES), "" = none; takes priority over an upload
  customFrame: boolean; // an uploaded border image replaces the dev-trait frame (file: card-art/<slug>/<id>.frame.png)
  frameInset: number;   // how far the card sits inside a custom border, in % of card width (0–10)
  nameFont: FontKey;
  numFont: FontKey | "art"; // "art" = Nick's rating/position images. Colors never change: white, gold at 99.
};

export const DEFAULT_LAYOUT: CardLayout = {
  ...(Object.fromEntries(CARD_LAYERS.map((l) => [l.key, true])) as Record<CardLayerKey, boolean>),
  stockFrame: "", customFrame: false, frameInset: 3.4, nameFont: "barlow", numFont: "art",
};

/** Fill in anything missing with the default and drop unknown keys / bad values. */
export function normalizeLayout(raw: unknown): CardLayout {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const pick = <T extends string>(v: unknown, ok: readonly { key: string }[], d: T) => (typeof v === "string" && ok.some((x) => x.key === v) ? (v as T) : d);
  return {
    ...(Object.fromEntries(CARD_LAYERS.map((l) => [l.key, o[l.key] === false ? false : true])) as Record<CardLayerKey, boolean>),
    stockFrame: typeof o.stockFrame === "string" && stockFrame(o.stockFrame) ? o.stockFrame : "",
    customFrame: o.customFrame === true,
    frameInset: typeof o.frameInset === "number" && isFinite(o.frameInset) ? Math.round(Math.min(10, Math.max(0, o.frameInset)) * 10) / 10 : DEFAULT_LAYOUT.frameInset,
    nameFont: pick<FontKey>(o.nameFont, CARD_FONTS, "barlow"),
    numFont: o.numFont === "art" ? "art" : pick<FontKey | "art">(o.numFont, CARD_FONTS, "art"),
  };
}

/** Only the settings that differ from the default (what gets stored). */
export const layoutDiff = (l: CardLayout) =>
  Object.fromEntries(Object.entries(l).filter(([k, v]) => DEFAULT_LAYOUT[k as keyof CardLayout] !== v && !(k === "frameInset" && !l.customFrame && !l.stockFrame)));
export const isDefaultLayout = (l: CardLayout) => Object.keys(layoutDiff(l)).length === 0;

/** The border image a card uses instead of its dev-trait frame: a stock border, else its upload (frameArt = signed URL), else none. */
export const effectiveFrame = (l?: CardLayout, frameArt?: string) =>
  !l ? undefined : l.stockFrame ? stockFramePath(l.stockFrame) : l.customFrame ? frameArt : undefined;

/** Classes on the .pcard root: hidden layers, a stock/uploaded border, text numbers. */
export const layoutClasses = (l?: CardLayout, frameArt?: string) =>
  !l ? "" : [
    !l.frame && "no-frame", !l.shade && "no-shade", !l.holo && "no-holo",
    effectiveFrame(l, frameArt) && "fs-custom",
    l.numFont !== "art" && "num-text",
  ].filter(Boolean).join(" ");

/** CSS variables on the .pcard root for a stock/uploaded border (frameArt = upload URL) and the fonts. */
export const layoutStyle = (l?: CardLayout, frameArt?: string): Record<string, string | number> => {
  if (!l) return {};
  const out: Record<string, string | number> = {};
  const fa = effectiveFrame(l, frameArt);
  if (fa) { out["--frame"] = `url("${fa}")`; out["--frame-inset"] = `${l.frameInset}cqw`; }
  if (l.nameFont !== "barlow") { const f = cardFont(l.nameFont); out["--name-font"] = `"${f.family}"`; out["--name-weight"] = f.weight; }
  if (l.numFont !== "art") { const f = cardFont(l.numFont); out["--num-font"] = `"${f.family}"`; out["--num-weight"] = f.weight; }
  return out;
};
