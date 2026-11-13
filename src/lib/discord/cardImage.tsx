// The player's trading card front as a 750×1050 PNG, for Discord embeds.
// (Satori can't draw outlined text, so the big jersey number is a faint fill instead of the site's outline.)
// Mirrors CardFront.tsx + the .pcard CSS in globals.css, rewritten for
// next/og (Satori): flexbox only, no CSS variables or color-mix, so team colors
// are mixed here. Keep the two in step when the card design changes.
import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { PlayerCardProps } from "@/components/league/CardFront";
import { sortAbilities, tierClass } from "@/components/league/CardFront";

export const CARD_W = 750, CARD_H = 1050;
const U = CARD_W / 100; // 1cqw

// Border (dev trait) and ability medallion gradients, from globals.css.
const FACE: Record<number, string> = {
  0: "linear-gradient(135deg, #8a5a2b, #e2a86a 30%, #7a4a1f 50%, #f0c28c 70%, #8a5a2b)",
  1: "linear-gradient(135deg, #8e97a8, #f4f6fa 28%, #9aa3b5 48%, #fff 68%, #8e97a8)",
  2: "linear-gradient(135deg, #9c6b00, #ffe27a 25%, #b8860b 45%, #fff3b0 62%, #a07000 80%, #ffd54a)",
  3: "linear-gradient(135deg, #5c0016, #e0115f 22%, #7a0020 42%, #ff4f7b 60%, #6b001b 80%, #c4103f)",
};
const FOIL: Record<number, string | null> = {
  0: null,
  1: "linear-gradient(115deg, transparent 30%, rgba(255,255,255,.22) 48%, transparent 62%)",
  2: "linear-gradient(115deg, transparent 20%, rgba(255,220,0,.16) 40%, rgba(255,250,200,.2) 50%, rgba(255,170,40,.14) 60%, transparent 80%)",
  3: "linear-gradient(115deg, transparent 28%, rgba(255,120,160,.26) 44%, rgba(255,220,230,.3) 50%, rgba(255,120,160,.26) 56%, transparent 72%)",
};
const ABIL: Record<string, { bg: string; color: string }> = {
  gold: { bg: "linear-gradient(135deg, #a77a00, #ffe27a 45%, #c99a10)", color: "#3a2a00" },
  silver: { bg: "linear-gradient(135deg, #8e97a8, #f4f6fa 45%, #a7b0c0)", color: "#1e2a44" },
  bronze: { bg: "linear-gradient(135deg, #7a4a1f, #e2a86a 45%, #8a5a2b)", color: "#2e1a05" },
  single: { bg: "linear-gradient(135deg, #5c0016, #e0115f 45%, #8a0026 80%, #ff4f7b)", color: "#fff" },
};

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", "").padEnd(6, "0").slice(0, 6), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const darken = (hex: string, k: number) => `rgb(${rgb(hex).map((v) => Math.round(v * k)).join(",")})`;
const alpha = (hex: string, a: number) => `rgba(${rgb(hex).join(",")},${a})`;

let fonts: Promise<{ name: string; data: Buffer; weight: 700 | 800; style: "normal" }[]> | null = null;
function loadFonts() {
  fonts ??= Promise.all(([700, 800] as const).map(async (weight) => ({
    name: "Barlow Condensed",
    data: await readFile(path.join(process.cwd(), "assets/fonts", `barlow-condensed-latin-${weight}-normal.woff`)),
    weight,
    style: "normal" as const,
  })));
  return fonts;
}

function AbilityName({ title }: { title: string }) {
  const words = title.replace(/[^A-Za-z0-9'& -]/g, " ").split(/[\s-]+/).filter(Boolean);
  const longest = Math.max(4, ...words.map((w) => w.length));
  const size = (Math.min(2.6, 18.5 / longest) - (words.length > 2 ? 0.2 : 0)) * U;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", width: "88%", fontSize: size, fontWeight: 800, lineHeight: 1.02, textTransform: "uppercase", letterSpacing: -0.3, textAlign: "center" }}>
      {words.map((w, i) => <span key={i}>{w}</span>)}
    </div>
  );
}

/** art: a data: URL (or nothing for the jersey-number card). cutout: art is a transparent headshot. */
export async function renderCard(p: PlayerCardProps, art?: string, cutout = false) {
  const pad = 2.8 * U;
  const tier = p.dev ?? 0;
  const ovr99 = p.ovr >= 99;
  const badge = 13.5 * U;
  const node = (
    <div style={{ width: CARD_W, height: CARD_H, display: "flex", padding: pad, borderRadius: 14, backgroundImage: FACE[tier] }}>
      <div style={{ position: "relative", display: "flex", width: "100%", height: "100%", borderRadius: 6, overflow: "hidden", backgroundColor: "#0a0f18", color: "#fff", fontFamily: "Barlow Condensed" }}>
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
          ? <img src={art} alt="" width={CARD_W} height={CARD_H} style={{ position: "absolute", left: -0.06 * (CARD_W - 2 * pad) - 0.02 * CARD_W, bottom: 0, width: (CARD_W - 2 * pad) * 1.04, height: (CARD_H - 2 * pad) * 1.04, objectFit: "cover", objectPosition: "50% 100%" }} />
          // eslint-disable-next-line @next/next/no-img-element
          : <img src={art} alt="" width={CARD_W} height={CARD_H} style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", objectFit: "cover" }} />)}
        {/* shade for legibility */}
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, display: "flex", backgroundImage: "linear-gradient(180deg, transparent 52%, rgba(5,8,14,.92) 86%)" }} />
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, display: "flex", backgroundImage: "linear-gradient(270deg, rgba(5,8,14,.55) 0%, transparent 26%)" }} />
        {FOIL[tier] && <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, display: "flex", backgroundImage: FOIL[tier]! }} />}

        <div style={{ position: "absolute", top: 3.4 * U, left: 4 * U, display: "flex", fontSize: 6 * U, fontWeight: 800, color: "rgba(255,255,255,.85)", textShadow: "0 1px 3px rgba(0,0,0,.6)" }}>#{p.jersey}</div>

        {/* right column: overall, position, team, abilities */}
        <div style={{ position: "absolute", top: 2.6 * U, right: 3 * U, width: 19 * U, display: "flex", flexDirection: "column", alignItems: "center", gap: 1.6 * U, textShadow: "0 1px 4px rgba(0,0,0,.6)" }}>
          <span style={{ fontSize: 17 * U, fontWeight: 800, lineHeight: 0.9, color: ovr99 ? "#ffd54a" : "#fff" }}>{p.ovr}</span>
          <span style={{ fontSize: 7.2 * U, fontWeight: 800, lineHeight: 1, marginTop: -0.6 * U }}>{p.pos}</span>
          <div style={{ width: badge, height: badge, borderRadius: badge, display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: p.primary, border: `${0.9 * U}px solid ${p.secondary}`, fontSize: 4.4 * U, fontWeight: 800, textShadow: "none" }}>{p.teamAbbr}</div>
          {sortAbilities(p.abilities).slice(0, 5).map((a) => {
            const s = ABIL[tierClass(a.tier)] || ABIL.bronze;
            return (
              <div key={a.title} style={{ width: badge, height: badge, borderRadius: badge, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", backgroundImage: s.bg, color: s.color, textShadow: "none", boxShadow: "0 1px 4px rgba(0,0,0,.5)", border: `${0.5 * U}px solid rgba(255,255,255,.55)` }}>
                <AbilityName title={a.title} />
              </div>
            );
          })}
        </div>

        {/* name */}
        <div style={{ position: "absolute", left: 4.5 * U, right: 24 * U, bottom: 4 * U, display: "flex", flexDirection: "column", lineHeight: 1, textShadow: "0 2px 6px rgba(0,0,0,.7)" }}>
          <span style={{ fontSize: 5.2 * U, fontWeight: 700, lineHeight: 1.1, textTransform: "uppercase", letterSpacing: 0.8, color: "#d7deea" }}>{p.first}</span>
          <span style={{ fontSize: (p.last.length > 11 ? 12 * 11 / p.last.length : 12) * U, fontWeight: 800, lineHeight: 0.95, textTransform: "uppercase" }}>{p.last}</span>
          {p.rookie && (
            <span style={{ alignSelf: "flex-start", marginTop: 1.6 * U, padding: `${0.9 * U}px ${5 * U}px ${0.9 * U}px ${3 * U}px`, fontSize: 4.2 * U, fontWeight: 800, letterSpacing: 1.2, textTransform: "uppercase", color: "#3a2a00", textShadow: "none",
              backgroundImage: "linear-gradient(135deg, #a77a00, #ffe27a 40%, #d4a017 60%, #fff3b0 80%, #b8860b)" }}>Rookie edition</span>
          )}
        </div>
        <div style={{ position: "absolute", right: 3 * U, bottom: 2.2 * U, display: "flex", fontSize: 3 * U, fontWeight: 700, letterSpacing: 1, color: "rgba(255,255,255,.55)", textTransform: "uppercase" }}>{p.setLabel}</div>
      </div>
    </div>
  );
  return new ImageResponse(node, {
    width: CARD_W, height: CARD_H, fonts: await loadFonts(),
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
