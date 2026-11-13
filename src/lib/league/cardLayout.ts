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
export type CardLayout = Record<CardLayerKey, boolean>;

export const DEFAULT_LAYOUT: CardLayout = Object.fromEntries(CARD_LAYERS.map((l) => [l.key, true])) as CardLayout;

/** Fill in anything missing with the default (on) and drop unknown keys. */
export function normalizeLayout(raw: unknown): CardLayout {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return Object.fromEntries(CARD_LAYERS.map((l) => [l.key, o[l.key] === false ? false : true])) as CardLayout;
}

export const isDefaultLayout = (l: CardLayout) => CARD_LAYERS.every((x) => l[x.key]);

/** Classes on the .pcard root for the layers CSS handles (frame, shade, holo). */
export const layoutClasses = (l?: CardLayout) =>
  !l ? "" : [!l.frame && "no-frame", !l.shade && "no-shade", !l.holo && "no-holo"].filter(Boolean).join(" ");
