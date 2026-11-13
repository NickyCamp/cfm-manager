// The player's trading card front as a 750×1050 PNG, for Discord embeds.
// (Satori can't draw outlined text, so the big jersey number is a faint fill instead of the site's outline.)
// Mirrors CardFront.tsx + the .pcard CSS in globals.css, rewritten for
// next/og (Satori): flexbox only, no CSS variables or color-mix, so team colors
// are mixed here. Keep the two in step when the card design changes.
import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { PlayerCardProps } from "@/components/league/CardFront";
import { cardFont, type CardLayerKey } from "@/lib/league/cardLayout";
import { abilityInitials, abScale, backScale, ovrArt, posArt, initialsSize, sortAbilities, tierClass, TILE_ART, xfLetter } from "@/components/league/CardFront";

export const CARD_W = 750, CARD_H = 1050;

// Border (dev trait) and ability medallion gradients, from globals.css.
const FACE: Record<number, string> = {
  0: "linear-gradient(135deg, #8a5a2b, #e2a86a 30%, #7a4a1f 50%, #f0c28c 70%, #8a5a2b)",
  1: "linear-gradient(135deg, #8e97a8, #f4f6fa 28%, #9aa3b5 48%, #fff 68%, #8e97a8)",
  2: "linear-gradient(135deg, #9c6b00, #ffe27a 25%, #b8860b 45%, #fff3b0 62%, #a07000 80%, #ffd54a)",
  3: "linear-gradient(135deg, #5c0016, #e0115f 22%, #7a0020 42%, #ff4f7b 60%, #6b001b 80%, #c4103f)",
};
const ABIL: Record<string, { bg: string; color: string }> = {
  gold: { bg: "linear-gradient(135deg, #a77a00, #ffe27a 45%, #c99a10)", color: "#3a2a00" },
  silver: { bg: "linear-gradient(135deg, #8e97a8, #f4f6fa 45%, #a7b0c0)", color: "#1e2a44" },
  bronze: { bg: "linear-gradient(135deg, #7a4a1f, #e2a86a 45%, #8a5a2b)", color: "#2e1a05" },
  single: { bg: "linear-gradient(135deg, #5c0016, #e0115f 45%, #8a0026 80%, #ff4f7b)", color: "#fff" },
};

// Nick's ruby X-Factor badges as data: URLs (Satori needs inline images), loaded once.
let gems: Promise<void> | null = null;
let gemSrc: Record<string, string> | null = null; // filled once xfGems() resolves; cardNode reads it
let tileSrc: Record<string, string> = {};
// Nick's card frames by dev trait (public/frames/*.png): 0 Normal bronze, 1 Star silver, 2 Superstar gold, 3 X-Factor ruby.
const FRAME_FILE = ["bronze", "silver", "gold", "xf"];
let frames: (string | null)[] = [];
const dataUrl = async (rel: string) => `data:image/png;base64,${(await readFile(path.join(process.cwd(), rel))).toString("base64")}`;
/** Loads the ruby X-Factor letters and the blank tier tiles (gold, ...) once. */
export function xfGems() {
  // Each asset loads on its own: a missing file only drops that piece of art (the card falls back to
  // the code-drawn look) instead of failing every card image, as happened when public/frames wasn't
  // traced into the function bundle (2026-11-13).
  const safe = (rel: string) => dataUrl(rel).catch((e) => { console.error("card asset missing", rel, e); return null; });
  gems ??= Promise.all([
    Promise.all(FRAME_FILE.map((f) => safe(`public/frames/${f}.png`))).then((u) => { frames = u; }),
    Promise.all([...TILE_ART].map(async (t) => [t, await safe(`public/abilities/${t}.png`)] as const))
      .then((e) => { tileSrc = Object.fromEntries(e.filter(([, u]) => u)) as Record<string, string>; }),
    Promise.all([..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"].map(async (c) => [c, await safe(`public/abilities/xf/${c}.png`)] as const))
      .then((e) => { gemSrc = Object.fromEntries(e.filter(([, u]) => u)) as Record<string, string>; }),
  ]).then(() => undefined);
  return gems;
}

// Team logos for the Discord images (Nick's request 2026-11-13): fetched from the logo URL once per
// server instance and inlined as data: URLs. On any failure the card keeps the abbreviation badge.
const logoCache = new Map<string, Promise<string | undefined>>();
function logoData(url: string) {
  if (!logoCache.has(url)) {
    logoCache.set(url, fetch(url, { signal: AbortSignal.timeout(4000) })
      .then(async (r) => (r.ok ? `data:${r.headers.get("content-type") || "image/png"};base64,${Buffer.from(await r.arrayBuffer()).toString("base64")}` : undefined))
      .catch(() => undefined)
      .then((v) => { if (!v) logoCache.delete(url); return v; }));
  }
  return logoCache.get(url)!;
}
/** The card props with teamLogo swapped for an inline data: URL (or removed if it can't be fetched). */
export async function withLogo<T extends { teamLogo?: string }>(p: T): Promise<T> {
  return { ...p, teamLogo: p.teamLogo && !p.teamLogo.startsWith("data:") ? await logoData(p.teamLogo) : p.teamLogo };
}

/** Outer card frame: Nick's frame image over the card (deeper padding so it doesn't cover corner text); the metallic gradient if the image is missing. */
const frameStyle = (tier: number, U: number, on = true, custom?: { inset: number }) =>
  !on ? { padding: 0 }
  : custom ? { position: "relative" as const, padding: custom.inset * U }
  : frames[tier]
    ? tier === 3
      ? { position: "relative" as const, paddingTop: 2.7 * U, paddingLeft: 3 * U, paddingRight: 3 * U, paddingBottom: 3.3 * U }
      : { position: "relative" as const, paddingTop: 3.4 * U, paddingLeft: 3.4 * U, paddingRight: 3.4 * U, paddingBottom: 3.6 * U }
    : { padding: 2.8 * U, backgroundImage: FACE[tier] };
const frameOverlay = (tier: number, W: number, H: number, on = true, custom?: string) =>
  // eslint-disable-next-line @next/next/no-img-element
  on && custom ? <img src={custom} alt="" width={W} height={H} style={{ position: "absolute", top: 0, left: 0, width: W, height: H }} />
  // eslint-disable-next-line @next/next/no-img-element
  : on && frames[tier] ? <img src={frames[tier]!} alt="" width={W} height={H} style={{ position: "absolute", top: 0, left: 0, width: W, height: H }} /> : null;

// Nick's overall/position art, loaded per card (only the files that card needs) and cached as data: URLs.
const artCache = new Map<string, string | null>();
/** Load the overall + position images a card needs; call before cardNode. Missing files fall back to text. */
export async function preloadOvrArt(cards: { ovr: number; pos: string }[]) {
  const want = new Set(cards.flatMap((c) => [ovrArt(c.ovr), posArt(c.pos, c.ovr >= 99)]).filter((x): x is string => !!x && !artCache.has(x)));
  await Promise.all([...want].map(async (u) => {
    artCache.set(u, await dataUrl(`public${u}`).catch((e) => { console.error("card asset missing", u, e); return null; }));
  }));
}
const artOf = (u: string | null) => (u ? artCache.get(u) ?? null : null);

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", "").padEnd(6, "0").slice(0, 6), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const darken = (hex: string, k: number) => `rgb(${rgb(hex).map((v) => Math.round(v * k)).join(",")})`;
const mix = (hex: string, other: string, k: number) => { const a = rgb(hex), b = rgb(other); return `rgb(${a.map((v, i) => Math.round(v * k + b[i] * (1 - k))).join(",")})`; };
const alpha = (hex: string, a: number) => `rgba(${rgb(hex).join(",")},${a})`;

type FontWeight = 400 | 600 | 700 | 800 | 900;
let fonts: Promise<{ name: string; data: Buffer; weight: FontWeight; style: "normal" }[]> | null = null;
const fontFile = (name: string, file: string, weight: FontWeight) =>
  readFile(path.join(process.cwd(), "assets/fonts", file)).then((data) => ({ name, data, weight, style: "normal" as const }));
export function cardFonts() {
  fonts ??= Promise.all([
    fontFile("Barlow Condensed", "barlow-condensed-latin-700-normal.woff", 700),
    fontFile("Barlow Condensed", "barlow-condensed-latin-800-normal.woff", 800),
    fontFile("Cinzel", "cinzel-latin-900-normal.woff", 900), // gold badge initials; card builder font
    // card builder fonts (src/lib/league/cardLayout.ts CARD_FONTS)
    fontFile("Bebas Neue", "bebas-neue-latin-400-normal.woff", 400),
    fontFile("Anton", "anton-latin-400-normal.woff", 400),
    fontFile("Oswald", "oswald-latin-700-normal.woff", 700),
    fontFile("Teko", "teko-latin-600-normal.woff", 600),
    fontFile("Graduate", "graduate-latin-400-normal.woff", 400),
  ]);
  return fonts;
}

/** art: a data: URL (or nothing for the jersey-number card). cutout: art is a transparent headshot. */
/** The card front as a Satori element, W pixels wide (5:7). art: a data: URL; cutout: art is a transparent headshot. */
export function cardNode(p: PlayerCardProps, art?: string, cutout = false, W = CARD_W) {
  const H = Math.round(W * 1.4), U = W / 100;
  const pad = 2.8 * U;
  const tier = p.dev ?? 0;
  const ovr99 = p.ovr >= 99;
  const UH = U * 0.78; // right-column HUD at 78% (Nick, 2026-11-13), matches the site's scale(0.78)
  const badge = 13.5 * UH;
  const show = (k: CardLayerKey) => !p.layout || p.layout[k]; // card builder layers
  const custom = p.layout?.customFrame && p.frameArt?.startsWith("data:") ? p.frameArt : undefined; // uploaded border
  const nameF = cardFont(p.layout?.nameFont ?? "barlow"), numF = p.layout && p.layout.numFont !== "art" ? cardFont(p.layout.numFont) : null;
  const A = UH * abScale(p.abilities.length), ab = 13.5 * A; // ability badges shrink when there are more than 5
  return (
    <div style={{ width: W, height: H, display: "flex", borderRadius: 1.9 * U, ...frameStyle(tier, U, show("frame"), custom ? { inset: p.layout!.frameInset } : undefined) }}>
      <div style={{ position: "relative", display: "flex", width: "100%", height: "100%", borderRadius: 0.8 * U, overflow: "hidden", backgroundColor: "#0a0f18", color: "#fff", fontFamily: "Barlow Condensed" }}>
        {/* art background */}
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, display: "flex", backgroundImage: `linear-gradient(160deg, ${darken(p.primary, 0.85)} 0%, #0a0f18 75%)` }} />
        {(!art || cutout) && (
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, display: "flex",
            backgroundImage: `linear-gradient(115deg, transparent 35%, ${alpha(p.secondary, 0.35)} 50%, transparent 65%)` }}>
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, display: "flex",
              backgroundImage: "radial-gradient(circle, rgba(255,255,255,.16) 0px, rgba(255,255,255,.16) 1.8px, transparent 2.4px)", backgroundSize: "15px 15px", backgroundRepeat: "repeat" }} />
            <span style={{ position: "absolute", left: 2 * U, top: -2 * U, fontSize: 78 * U, fontWeight: 800, lineHeight: 1, letterSpacing: -2 * U,
              color: alpha(p.secondary, 0.22) }}>{p.jersey}</span>
          </div>
        )}
        {art && (cutout
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={art} alt="" width={W} height={H} style={{ position: "absolute", left: -0.06 * (W - 2 * pad) - 0.02 * W, bottom: 0, width: (W - 2 * pad) * 1.04, height: (H - 2 * pad) * 1.04, objectFit: "cover", objectPosition: "50% 100%" }} />
          // eslint-disable-next-line @next/next/no-img-element
          : <img src={art} alt="" width={W} height={H} style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", objectFit: "cover" }} />)}
        {/* shade for legibility */}
        {show("shade") && <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, display: "flex", backgroundImage: "linear-gradient(180deg, transparent 52%, rgba(5,8,14,.92) 86%)" }} />}
        {show("shade") && <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, display: "flex", backgroundImage: "linear-gradient(270deg, rgba(5,8,14,.55) 0%, transparent 26%)" }} />}
        {/* No holo foil sheen here (Nick, 2026-11-13): the site animates it, but on a static image it just looks hazy. */}


        {/* right column: overall, position, team, abilities */}
        <div style={{ position: "absolute", top: 2.6 * U, right: 4.6 * U, width: 19 * UH, display: "flex", flexDirection: "column", alignItems: "center", gap: 1.6 * UH, textShadow: "0 1px 4px rgba(0,0,0,.6)" }}>
          {show("ovr") && <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1.6 * UH }}>
          {artOf(ovrArt(p.ovr)) && !numF
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={artOf(ovrArt(p.ovr))!} alt="" width={21 * UH} height={21 * UH * 140 / 192} style={{ width: 21 * UH, height: 21 * UH * 140 / 192, marginTop: -1.3 * UH, marginBottom: -1.5 * UH }} />
            : <span style={{ fontSize: 17 * UH, fontWeight: numF?.weight ?? 800, fontFamily: numF?.family ?? "Barlow Condensed", lineHeight: 0.9, color: ovr99 ? "#ffd54a" : "#fff" }}>{p.ovr}</span>}
          <div style={{ width: 9.5 * UH, height: 0.6 * UH, borderRadius: 0.3 * UH, display: "flex", backgroundImage: ovr99 ? "linear-gradient(180deg, #ffd54a, #c98a00)" : "linear-gradient(180deg, #e8ecf2, #e8ecf2)" }} />
          {artOf(posArt(p.pos, ovr99)) && !numF
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={artOf(posArt(p.pos, ovr99))!} alt="" width={21 * UH} height={21 * UH * 58 / 192} style={{ width: 21 * UH, height: 21 * UH * 58 / 192, marginTop: -0.5 * UH, marginBottom: -0.5 * UH }} />
            : <span style={{ fontSize: 7.2 * UH, fontWeight: numF?.weight ?? 800, fontFamily: numF?.family ?? "Barlow Condensed", lineHeight: 1, marginTop: -0.6 * UH, color: ovr99 ? "#ffd54a" : "#fff" }}>{p.pos}</span>}
          </div>}
          {show("team") && (p.teamLogo?.startsWith("data:")
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={p.teamLogo} alt="" width={badge} height={badge} style={{ width: badge, height: badge, objectFit: "contain" }} />
            : <div style={{ width: badge, height: badge, borderRadius: badge, display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: p.primary, border: `${0.9 * UH}px solid ${p.secondary}`, fontSize: 4.4 * UH, fontWeight: 800, textShadow: "none" }}>{p.teamAbbr}</div>)}
          {show("abilities") && sortAbilities(p.abilities).map((a) => {
            const t = tierClass(a.tier), s = ABIL[t] || ABIL.bronze, ini = abilityInitials(a.title);
            const gem = t === "single" && gemSrc ? gemSrc[xfLetter(a.title) ?? ""] : undefined;
            // eslint-disable-next-line @next/next/no-img-element
            if (gem) return <img key={a.title} src={gem} alt="" width={14 * A} height={14 * A} style={{ width: 14 * A, height: 14 * A }} />;
            if (tileSrc[t]) {
              // Nick's tier tiles: gold = engraved Cinzel serif; silver/bronze = stout Barlow Condensed (navy / dark-brown outline).
              const k = 14 * A, silver = t === "silver" || t === "bronze";
              const fs = silver ? (({ 1: 9.4, 2: 7.6, 3: 5.8 } as Record<number, number>)[ini.length] ?? 4.6) : (({ 1: 8.6, 2: 6.4, 3: 4.6 } as Record<number, number>)[ini.length] ?? 3.6);
              const line = t === "silver" ? "#0f1a2b" : t === "bronze" ? "#2e1405" : "#4a2c06", o = 1.5;
              const outline = `-${o}px -${o}px 0 ${line}, ${o}px -${o}px 0 ${line}, -${o}px ${o}px 0 ${line}, ${o}px ${o}px 0 ${line}, 0 ${o}px 0 ${line}, 0 -${o}px 0 ${line}, 0 3px 3px rgba(0,0,0,.5)`;
              return (
                <div key={a.title} style={{ position: "relative", width: k, height: k, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={tileSrc[t]} alt="" width={k} height={k} style={{ position: "absolute", top: 0, left: 0, width: k, height: k }} />
                  <span style={{ fontFamily: silver ? "Barlow Condensed" : "Cinzel", fontWeight: silver ? 800 : 900, fontSize: fs * A, lineHeight: 1, marginTop: silver ? 0 : 0.3 * A,
                    color: t === "silver" ? "#eef1f6" : t === "bronze" ? "#d9914f" : "#f6ead0", textShadow: outline }}>{ini}</span>
                </div>
              );
            }
            if (t === "single") {
              // Cut ruby square: bevelled facets from per-side border colors, a lighter table in the middle.
              const g = 12.5 * A;
              return (
                <div key={a.title} style={{ position: "relative", width: g, height: g, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 1.2 * A,
                  borderStyle: "solid", borderWidth: 2.6 * A, borderTopColor: "#ff6f93", borderRightColor: "#8a0026", borderBottomColor: "#4a0012", borderLeftColor: "#c4103f",
                  backgroundImage: "linear-gradient(135deg, #ff8fab 0%, #e0115f 38%, #a3002c 70%, #6b001b 100%)", boxShadow: "0 1px 5px rgba(0,0,0,.6)",
                  color: "#fff", fontSize: initialsSize(ini.length) * ab, fontWeight: 800, lineHeight: 1, textShadow: "0 1px 2px rgba(60,0,15,.8)" }}>
                  {ini}
                </div>
              );
            }
            return (
              <div key={a.title} style={{ width: ab, height: ab, borderRadius: ab, display: "flex", alignItems: "center", justifyContent: "center", backgroundImage: s.bg, color: s.color, textShadow: "none",
                boxShadow: "0 1px 4px rgba(0,0,0,.5)", border: `${0.5 * A}px solid rgba(255,255,255,.55)`, fontSize: initialsSize(ini.length) * ab, fontWeight: 800, lineHeight: 1 }}>
                {ini}
              </div>
            );
          })}
        </div>

        {/* name */}
        {show("name") && <div style={{ position: "absolute", left: 4.5 * U, right: 24 * U, bottom: 4 * U, display: "flex", flexDirection: "column", lineHeight: 1, textShadow: "0 2px 6px rgba(0,0,0,.7)" }}>
          <span style={{ fontSize: 5.2 * U, fontFamily: nameF.family, fontWeight: nameF.key === "barlow" ? 700 : nameF.weight, lineHeight: 1.1, textTransform: "uppercase", letterSpacing: 0.8, color: ovr99 ? "#f7d978" : "#d7deea" }}>{p.first}</span>
          <span style={{ fontSize: (p.last.length > 11 ? 12 * 11 / p.last.length : 12) * U, fontFamily: nameF.family, fontWeight: nameF.weight, lineHeight: 0.95, textTransform: "uppercase", color: ovr99 ? "#ffcf3a" : "#fff" }}>{p.last}</span>
          {p.rookie && (
            <span style={{ alignSelf: "flex-start", marginTop: 1.6 * U, padding: `${0.9 * U}px ${5 * U}px ${0.9 * U}px ${3 * U}px`, fontSize: 4.2 * U, fontWeight: 800, letterSpacing: 1.2, textTransform: "uppercase", color: "#3a2a00", textShadow: "none",
              backgroundImage: "linear-gradient(135deg, #a77a00, #ffe27a 40%, #d4a017 60%, #fff3b0 80%, #b8860b)" }}>Rookie edition</span>
          )}
        </div>}
        {show("name") && <div style={{ position: "absolute", right: 3 * U, bottom: 2.2 * U, display: "flex", fontSize: 3 * U, fontWeight: 700, letterSpacing: 1, color: "rgba(255,255,255,.55)", textTransform: "uppercase" }}>{p.setLabel}</div>}
      </div>
      {frameOverlay(tier, W, H, show("frame"), custom)}
    </div>
  );
}

const moneyShort = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toFixed(n >= 1e8 ? 0 : 1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}K` : `$${n}`);
const ABIL_CHIP: Record<string, { bg: string; color: string }> = {
  gold: { bg: "linear-gradient(135deg, #a77a00, #ffe27a 45%, #c99a10)", color: "#3a2a00" },
  silver: { bg: "linear-gradient(135deg, #8e97a8, #f4f6fa 45%, #a7b0c0)", color: "#1e2a44" },
  bronze: { bg: "linear-gradient(135deg, #7a4a1f, #e2a86a 45%, #8a5a2b)", color: "#2e1a05" },
  single: { bg: "linear-gradient(135deg, #5c0016, #e0115f 45%, #8a0026 80%, #ff4f7b)", color: "#fff" },
};

/** The card back as a Satori element, W pixels wide. Mirrors CardBackInner + the .kb-* CSS. */
export function cardBackNode(p: PlayerCardProps, W = CARD_W) {
  const H = Math.round(W * 1.4), U0 = W / 100;
  const U = U0 * backScale(p); // body sizes shrink when there's more to fit; the frame and header keep U0
  const tier = p.dev ?? 0;
  const nameF = cardFont(p.layout?.nameFont ?? "barlow"), numF = p.layout && p.layout.numFont !== "art" ? cardFont(p.layout.numFont) : null; // card builder fonts
  const muted = "#9aa6bd";
  const cell = (label: string, value: string | number, hi = false, key?: string) => (
    <div key={key ?? label} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", width: "30%", paddingBottom: 0.6 * U, borderBottom: "1px solid rgba(255,255,255,.08)" }}>
      <span style={{ fontSize: 3.6 * U, fontWeight: 700, color: muted }}>{label}</span>
      <span style={{ fontSize: 5.4 * U, fontWeight: 800, color: hi ? "#ffd54a" : "#fff" }}>{String(value)}</span>
    </div>
  );
  const box = (label: string, items: { v: string; l: string; r?: string }[]) => (
    <div style={{ display: "flex", flexDirection: "column", borderRadius: 1.6 * U, backgroundColor: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.08)", padding: `${1.6 * U}px ${2.4 * U}px ${2 * U}px` }}>
      <span style={{ fontSize: 3.3 * U, fontWeight: 800, letterSpacing: 1.2, color: muted, textTransform: "uppercase", marginBottom: 1.4 * U }}>{label}</span>
      <div style={{ display: "flex", gap: 2 * U }}>
        {items.map((it) => (
          <div key={it.l} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center" }}>
            <span style={{ fontSize: 5.6 * U, fontWeight: 800, lineHeight: 1 }}>{it.v}</span>
            <span style={{ fontSize: 2.9 * U, fontWeight: 700, color: muted, textTransform: "uppercase", letterSpacing: 0.5, marginTop: 0.4 * U }}>{it.l}</span>
            {it.r && (/^(T-)?(1st|2nd|3rd)$/.test(it.r)
              ? <span style={{ marginTop: 0.8 * U, padding: `${0.4 * U}px ${1.4 * U}px`, borderRadius: U, fontSize: 3.1 * U, fontWeight: 800, color: "#3a2a00", backgroundImage: "linear-gradient(135deg, #a77a00, #ffe27a 45%, #c99a10)" }}>{it.r}</span>
              : <span style={{ marginTop: 0.8 * U, padding: `${0.4 * U}px ${1.4 * U}px`, borderRadius: U, fontSize: 3.1 * U, fontWeight: 800, color: "#c3cde0", backgroundColor: "rgba(255,255,255,.08)" }}>{it.r}</span>)}
          </div>
        ))}
      </div>
    </div>
  );
  const cells = [cell("HT", p.height || "—"), cell("WT", p.weight || "—"), cell("AGE", p.age), ...p.stats.map((st) => cell(st.abbr, st.value, st.value >= 90, st.abbr + st.label))];
  return (
    <div style={{ width: W, height: H, display: "flex", borderRadius: 1.9 * U0, ...frameStyle(tier, U0, !p.layout || p.layout.frame, p.layout?.customFrame && p.frameArt?.startsWith("data:") ? { inset: p.layout.frameInset } : undefined) }}>
      <div style={{ position: "relative", display: "flex", flexDirection: "column", width: "100%", height: "100%", borderRadius: 0.8 * U0, overflow: "hidden", color: "#fff", fontFamily: "Barlow Condensed",
        backgroundImage: `linear-gradient(180deg, ${mix(p.primary, "#0a0f18", 0.55)} 0%, #0a0f18 32%, #0a0f18 100%)` }}>
        {/* header: name, team line, overall */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: `${3.2 * U0}px ${4 * U0}px ${2.6 * U0}px`, borderBottom: `${0.6 * U0}px solid ${p.secondary}` }}>
          <div style={{ display: "flex", flexDirection: "column", lineHeight: 1 }}>
            <span style={{ fontSize: 4.4 * U0, fontFamily: nameF.family, fontWeight: nameF.key === "barlow" ? 700 : nameF.weight, color: p.ovr >= 99 ? "#f7d978" : "#d7deea", textTransform: "uppercase", letterSpacing: 0.8 }}>{p.first}</span>
            <span style={{ fontSize: (p.last.length > 13 ? 9.4 * 13 / p.last.length : 9.4) * U0, fontFamily: nameF.family, fontWeight: nameF.weight, textTransform: "uppercase", lineHeight: 0.95, color: p.ovr >= 99 ? "#ffcf3a" : "#fff" }}>{p.last}</span>
            <div style={{ display: "flex", alignItems: "center", gap: 1.6 * U0, marginTop: 1.8 * U0, fontSize: 4 * U0, fontWeight: 700, color: "#c3cde0" }}>
              {p.teamLogo?.startsWith("data:")
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={p.teamLogo} alt="" width={8.4 * U0} height={8.4 * U0} style={{ width: 8.4 * U0, height: 8.4 * U0, objectFit: "contain" }} />
                : <div style={{ width: 8.4 * U0, height: 8.4 * U0, borderRadius: 8.4 * U0, display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: p.primary, border: `${0.7 * U0}px solid ${p.secondary}`, color: "#fff", fontSize: 2.9 * U0, fontWeight: 800 }}>{p.teamAbbr}</div>}
              <span>{`${p.pos} · #${p.jersey} · ${p.exp}`}</span>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            <span style={{ fontSize: 14 * U0, fontFamily: numF?.family ?? "Barlow Condensed", fontWeight: numF?.weight ?? 800, lineHeight: 0.9, color: p.ovr >= 99 ? "#ffd54a" : "#fff" }}>{p.ovr}</span>
            <span style={{ fontSize: 3.6 * U0, fontWeight: 800, letterSpacing: 1.2, color: "#c3cde0" }}>OVR</span>
          </div>
        </div>
        {/* body */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 * U, padding: `${2.6 * U}px ${4 * U}px ${3 * U}px` }}>
          <div style={{ display: "flex", flexWrap: "wrap", columnGap: 4 * U, rowGap: 1.2 * U }}>{cells}</div>
          {p.season && box(`${p.season.year} season`, p.season.items.map((it) => ({ v: it.value, l: it.label, r: it.rank })))}
          {p.deal !== undefined && box("Contract", p.deal
            ? [{ v: moneyShort(p.deal.capHit), l: `${p.season?.year ?? ""} cap hit` }, { v: String(p.deal.yearsLeft), l: p.deal.yearsLeft === 1 ? "Year left" : "Years left" }, { v: moneyShort(p.deal.total), l: `${p.deal.length} yr deal` }]
            : [{ v: "FA", l: "Free agent" }])}
          {p.abilities.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 1.2 * U }}>
              {sortAbilities(p.abilities).map((a) => {
                const c = ABIL_CHIP[tierClass(a.tier)] || ABIL_CHIP.bronze;
                return <span key={a.title} style={{ fontSize: 3.4 * U, fontWeight: 700, padding: `${0.5 * U}px ${1.6 * U}px`, borderRadius: U, backgroundImage: c.bg, color: c.color }}>{a.title}</span>;
              })}
            </div>
          )}
          <span style={{ marginTop: "auto", fontSize: 3.6 * U, fontWeight: 700, color: muted }}>{`${p.college || "No college"} · ${p.draft}`}</span>
        </div>
      </div>
      {frameOverlay(tier, W, H, !p.layout || p.layout.frame, p.layout?.customFrame && p.frameArt?.startsWith("data:") ? p.frameArt : undefined)}
    </div>
  );
}

/** Front and back side by side, each W wide, as one Satori element. */
export function cardPairNode(p: PlayerCardProps, art?: string, cutout = false, W = 600) {
  const gap = 24, padding = 20;
  return (
    <div style={{ display: "flex", gap, padding, backgroundColor: "#070a14", width: 2 * W + gap + 2 * padding, height: Math.round(W * 1.4) + 2 * padding }}>
      <div style={{ display: "flex" }}>{cardNode(p, art, cutout, W)}</div>
      <div style={{ display: "flex" }}>{cardBackNode(p, W)}</div>
    </div>
  );
}
export const pairSize = (W = 600) => ({ width: 2 * W + 24 + 40, height: Math.round(W * 1.4) + 40 });

/** The card as a PNG: the front alone (750×1050), or front and back side by side. */
export async function renderCard(p: PlayerCardProps, art?: string, cutout = false, side: "front" | "both" = "front") {
  const size = side === "both" ? pairSize() : { width: CARD_W, height: CARD_H };
  await Promise.all([xfGems(), preloadOvrArt([p])]);
  p = await withLogo(p);
  return new ImageResponse(side === "both" ? cardPairNode(p, art, cutout) : cardNode(p, art, cutout), {
    ...size, fonts: await cardFonts(),
    headers: { "cache-control": "public, max-age=3600, s-maxage=3600" },
  });
}

/** Downloads an image and returns it as a data: URL Satori can draw (null if it isn't a PNG/JPEG). */
export async function imageDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: { accept: "image/png,image/jpeg" }, cache: "no-store" });
    if (!res.ok) return null;
    const type = (res.headers.get("content-type") || "").split(";")[0];
    if (!/^image\/(png|jpeg)$/.test(type)) return null;
    return `data:${type};base64,${Buffer.from(await res.arrayBuffer()).toString("base64")}`;
  } catch {
    return null;
  }
}
