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
const mix = (hex: string, other: string, k: number) => { const a = rgb(hex), b = rgb(other); return `rgb(${a.map((v, i) => Math.round(v * k + b[i] * (1 - k))).join(",")})`; };
const alpha = (hex: string, a: number) => `rgba(${rgb(hex).join(",")},${a})`;

let fonts: Promise<{ name: string; data: Buffer; weight: 700 | 800; style: "normal" }[]> | null = null;
export function cardFonts() {
  fonts ??= Promise.all(([700, 800] as const).map(async (weight) => ({
    name: "Barlow Condensed",
    data: await readFile(path.join(process.cwd(), "assets/fonts", `barlow-condensed-latin-${weight}-normal.woff`)),
    weight,
    style: "normal" as const,
  })));
  return fonts;
}

function AbilityName({ title, U }: { title: string; U: number }) {
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
/** The card front as a Satori element, W pixels wide (5:7). art: a data: URL; cutout: art is a transparent headshot. */
export function cardNode(p: PlayerCardProps, art?: string, cutout = false, W = CARD_W) {
  const H = Math.round(W * 1.4), U = W / 100;
  const pad = 2.8 * U;
  const tier = p.dev ?? 0;
  const ovr99 = p.ovr >= 99;
  const badge = 13.5 * U;
  return (
    <div style={{ width: W, height: H, display: "flex", padding: pad, borderRadius: 1.9 * U, backgroundImage: FACE[tier] }}>
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
                <AbilityName title={a.title} U={U} />
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
  const H = Math.round(W * 1.4), U = W / 100;
  const pad = 2.8 * U;
  const tier = p.dev ?? 0;
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
    <div style={{ width: W, height: H, display: "flex", padding: pad, borderRadius: 1.9 * U, backgroundImage: FACE[tier] }}>
      <div style={{ position: "relative", display: "flex", flexDirection: "column", width: "100%", height: "100%", borderRadius: 0.8 * U, overflow: "hidden", color: "#fff", fontFamily: "Barlow Condensed",
        backgroundImage: `linear-gradient(180deg, ${mix(p.primary, "#0a0f18", 0.55)} 0%, #0a0f18 32%, #0a0f18 100%)` }}>
        {/* header: name, team line, overall */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: `${3.2 * U}px ${4 * U}px ${2.6 * U}px`, borderBottom: `${0.6 * U}px solid ${p.secondary}` }}>
          <div style={{ display: "flex", flexDirection: "column", lineHeight: 1 }}>
            <span style={{ fontSize: 4.4 * U, fontWeight: 700, color: "#d7deea", textTransform: "uppercase", letterSpacing: 0.8 }}>{p.first}</span>
            <span style={{ fontSize: (p.last.length > 13 ? 9.4 * 13 / p.last.length : 9.4) * U, fontWeight: 800, textTransform: "uppercase", lineHeight: 0.95 }}>{p.last}</span>
            <div style={{ display: "flex", alignItems: "center", gap: 1.6 * U, marginTop: 1.8 * U, fontSize: 4 * U, fontWeight: 700, color: "#c3cde0" }}>
              <div style={{ width: 8.4 * U, height: 8.4 * U, borderRadius: 8.4 * U, display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: p.primary, border: `${0.7 * U}px solid ${p.secondary}`, color: "#fff", fontSize: 2.9 * U, fontWeight: 800 }}>{p.teamAbbr}</div>
              <span>{`${p.pos} · #${p.jersey} · ${p.exp}`}</span>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            <span style={{ fontSize: 14 * U, fontWeight: 800, lineHeight: 0.9, color: p.ovr >= 99 ? "#ffd54a" : "#fff" }}>{p.ovr}</span>
            <span style={{ fontSize: 3.6 * U, fontWeight: 800, letterSpacing: 1.2, color: "#c3cde0" }}>OVR</span>
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
