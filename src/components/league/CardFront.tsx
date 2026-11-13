import type React from "react";
// Card front, shared by the flippable PlayerCard (player pages) and the static
// cards in the team binder and top-players stack. No hooks: works on the server.
import type { CardStat, SeasonItem } from "@/lib/league/cardStats";
import { logoVar } from "@/lib/league/logos";
import { layoutClasses, layoutStyle, type CardLayerKey, type CardLayout } from "@/lib/league/cardLayout";

export type PlayerCardProps = {
  first: string;
  last: string;
  pos: string;
  jersey: number;
  ovr: number;
  dev: 0 | 1 | 2 | 3;
  rookie: boolean;
  teamAbbr: string;
  teamLogo?: string;     // NFL logo URL; only drawn for signed-in visitors (.logos-on)
  primary: string;
  secondary: string;
  setLabel: string;      // e.g. "2027 NCL"
  exp: string;           // "Rookie", "4th yr"
  age: number;
  height: string;        // 6'2"
  weight: number;
  college: string;
  draft: string;         // "R1 #12, 2024" or "Undrafted"
  art?: string;
  cutout?: boolean;      // art is a transparent headshot: show it over the number backdrop
  abilities: { title: string; tier: string }[];
  layout?: CardLayout;   // card builder: which built-in layers show (default: all), fonts, custom border
  frameArt?: string;     // URL of this card's uploaded border (layout.customFrame), when the viewer may see it
  stats: CardStat[];
  // Card back extras (player page and the Discord bot; not needed for front-only cards):
  season?: { year: number; items: SeasonItem[] };
  deal?: { capHit: number; yearsLeft: number; length: number; total: number } | null; // null = free agent
};

export const CARD_TIER = ["normal", "star", "super", "xf"] as const;
const TIER_RANK: Record<string, number> = { single: 0, gold: 1, silver: 2, bronze: 3 };
// EA data says "X-Factor"; the abilities reference data says "Single". Both are X-Factor.
export const tierClass = (t: string) => {
  const k = t.toLowerCase().replace(/[^a-z]/g, "");
  if (k === "xfactor" || k === "single") return "single";
  return k in TIER_RANK ? k : "bronze";
};
export const sortAbilities = (a: { title: string; tier: string }[]) =>
  [...a].sort((x, y) => (TIER_RANK[tierClass(x.tier)] ?? 9) - (TIER_RANK[tierClass(y.tier)] ?? 9));
/** An ability's initials for the card front ("Bazooka" → B, "Pocket Passer" → PP). The back spells names out. */
export const abilityInitials = (title: string) =>
  title.replace(/[^A-Za-z0-9 -]/g, " ").split(/[\s-]+/).filter(Boolean).map((w) => w[0]).join("").toUpperCase().slice(0, 4);
/** X-Factor badges are Nick's ruby art, one per letter (public/abilities/xf/<A-Z>.png), using the name's first letter. */
export const xfLetter = (title: string) => { const c = title.trim().charAt(0).toUpperCase(); return c >= "A" && c <= "Z" ? c : null; };
/** Tiers drawn on Nick's badge art (public/abilities/<tier>.png, a blank tile) with engraved serif initials on top. */
export const TILE_ART = new Set(["gold", "silver", "bronze"]);
/** Ability badges shrink to fit when a player has more than 5 (QBs often do), so none get dropped. 1 = full size. */
export const abScale = (n: number) => (n <= 5 ? 1 : Math.max(0.5, (78 / n - 1.6) / 14));
/** Nick's overall/position art (public/ovr): r/<00-99>.png (white, gold at 99) and pos/<W|G>_<POS>.png.
 *  Madden 26 codes his pack doesn't have map to the nearest one; anything else falls back to text. */
const POS_ART = new Set(["C","CB","DT","EDGE","FB","FS","HB","ILB","K","LB","LDE","LE","LG","LOLB","LS","LT","MLB","NT","OLB","P","QB","RB","RDE","RE","RG","ROLB","RT","S","SS","TE","WR"]);
const POS_ALIAS: Record<string, string> = { LEDG: "EDGE", REDG: "EDGE", MIKE: "MLB", SAM: "OLB", WILL: "OLB" };
export const ovrArt = (ovr: number) => (Number.isInteger(ovr) && ovr >= 0 && ovr <= 99 ? `/ovr/r/${String(ovr).padStart(2, "0")}.png` : null);
export const posArt = (pos: string, gold: boolean) => {
  const k = POS_ALIAS[pos.toUpperCase()] ?? pos.toUpperCase();
  return POS_ART.has(k) ? `/ovr/pos/${gold ? "G" : "W"}_${k}.png` : null;
};
/** Font size for the initials, as a fraction of the medallion width. */
export const initialsSize = (n: number) => (n <= 1 ? 0.5 : n === 2 ? 0.42 : n === 3 ? 0.33 : 0.27);

export function CardFrontInner(p: Pick<PlayerCardProps, "first" | "last" | "pos" | "jersey" | "ovr" | "rookie" | "teamAbbr" | "teamLogo" | "art" | "cutout" | "abilities" | "layout">) {
  const L = p.layout;
  const show = (k: CardLayerKey) => !L || L[k];
  const numText = !!L && L.numFont !== "art"; // chosen font instead of the rating art (same colors: white, gold at 99)
  return (
    <div className="pcard-inner">
      <div className={`pcard-art ${p.art ? "has-img" : ""} ${p.art && p.cutout ? "cutout" : ""}`}>
        {(!p.art || p.cutout) && <div className="pcard-ph" aria-hidden><span>{p.jersey}</span></div>}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {p.art && <img src={p.art} alt="" loading="lazy" />}
      </div>
      <div className="pcard-shade" />
      <div className="pcard-side" style={{ "--abk": abScale(p.abilities.length) } as React.CSSProperties}>
        {show("ovr") && <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {ovrArt(p.ovr) && !numText ? <img className="ovr-img" src={ovrArt(p.ovr)!} alt={String(p.ovr)} /> : <b className={`ovr ${p.ovr >= 99 ? "ovr-99" : ""}`}>{p.ovr}</b>}
          <span className={`ovr-rule ${p.ovr >= 99 ? "gold" : ""}`} aria-hidden />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {posArt(p.pos, p.ovr >= 99) && !numText ? <img className="pos-img" src={posArt(p.pos, p.ovr >= 99)!} alt={p.pos} /> : <span className={`pos ${p.ovr >= 99 ? "pos-99" : ""}`}>{p.pos}</span>}
        </>}
        {show("team") && <span className={`team${p.teamLogo ? " has-logo" : ""}`} style={logoVar(p.teamLogo)}>{p.teamAbbr}</span>}
        {show("abilities") && sortAbilities(p.abilities).map((a) => (
          tierClass(a.tier) === "single" && xfLetter(a.title)
            // eslint-disable-next-line @next/next/no-img-element
            ? <img key={a.title} className="abil-gem" src={`/abilities/xf/${xfLetter(a.title)}.png`} alt={xfLetter(a.title)!} title={`${a.title} (X-Factor)`} />
            : <span key={a.title} className={`abil ab-${tierClass(a.tier)}${TILE_ART.has(tierClass(a.tier)) ? " tile" : ""}`} title={`${a.title} (${tierClass(a.tier) === "single" ? "X-Factor" : a.tier})`}><span className="abil-ini" data-n={abilityInitials(a.title).length}>{abilityInitials(a.title)}</span></span>
        ))}
      </div>
      {show("name") && <Nameplate first={p.first} last={p.last} rookie={p.rookie} />}
      <div className="pcard-foil" /><div className="pcard-glare" />
    </div>
  );
}

const moneyShort = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toFixed(n >= 1e8 ? 0 : 1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}K` : `$${n}`);

/** How much to shrink the back's body so everything fits: more rating rows (WRs have 7 position
 *  ratings) and longer ability lists need smaller type. 1 = normal size. */
export function backScale(p: Pick<PlayerCardProps, "stats" | "abilities">) {
  const rows = Math.ceil((3 + p.stats.length) / 3);
  const chipChars = p.abilities.reduce((a, x) => a + x.title.length + 4, 0);
  const abilLines = p.abilities.length ? Math.ceil(chipChars / 44) : 0;
  const load = rows + abilLines; // 4 rows + 1 line of chips fits at full size
  return load <= 5 ? 1 : load === 6 ? 0.94 : load === 7 ? 0.88 : 0.8;
}

/** The card back: fills the whole card like a real trading card's back. */
export function CardBackInner(p: PlayerCardProps) {
  return (
    <div className="pcard-inner pcard-inner-back">
      <div className="kb-head">
        <div className="kb-name">
          <span className="first">{p.first}</span>
          <span className="last">{p.last}</span>
          <span className="kb-sub"><span className={`team${p.teamLogo ? " has-logo" : ""}`} style={logoVar(p.teamLogo)}>{p.teamAbbr}</span>{p.pos} · #{p.jersey} · {p.exp}</span>
        </div>
        <div className="kb-ovr"><b className={p.ovr >= 99 ? "ovr-99" : ""}>{p.ovr}</b><span>OVR</span></div>
      </div>
      <div className="kb-body" style={{ "--k": backScale(p) } as React.CSSProperties}>
        <div className="kgrid">
          <div><span>HT</span><b>{p.height || "—"}</b></div>
          <div><span>WT</span><b>{p.weight || "—"}</b></div>
          <div><span>AGE</span><b>{p.age}</b></div>
          {p.stats.map((s) => (
            <div key={s.abbr + s.label} title={s.label} className={s.value >= 90 ? "hi" : ""}><span>{s.abbr}</span><b>{s.value}</b></div>
          ))}
        </div>
        {p.stats.length === 0 && <p className="pcard-none">Ratings arrive with the next sync.</p>}
        {p.season && (
          <div className="kb-box">
            <div className="kb-label">{p.season.year} season</div>
            <div className="kb-row">{p.season.items.map((s) => (
              <div key={s.label}><b>{s.value}</b><span>{s.label}</span>{s.rank && <em className={/^(T-)?(1st|2nd|3rd)$/.test(s.rank) ? "top" : ""}>{s.rank}</em>}</div>
            ))}</div>
          </div>
        )}
        {p.deal !== undefined && (
          <div className="kb-box">
            <div className="kb-label">Contract</div>
            {p.deal ? (
              <div className="kb-row">
                <div><b>{moneyShort(p.deal.capHit)}</b><span>{p.season?.year ?? ""} cap hit</span></div>
                <div><b>{p.deal.yearsLeft}</b><span>{p.deal.yearsLeft === 1 ? "Year left" : "Years left"}</span></div>
                <div><b>{moneyShort(p.deal.total)}</b><span>{p.deal.length} yr deal</span></div>
              </div>
            ) : <div className="kb-row"><div><b>FA</b><span>Free agent</span></div></div>}
          </div>
        )}
        {p.abilities.length > 0 && (
          <div className="kabil">{sortAbilities(p.abilities).map((a) => (
            <span key={a.title} className={`ab-${tierClass(a.tier)}`}>{a.title}</span>
          ))}</div>
        )}
        <div className="kbio">{p.college || "No college"} · {p.draft}</div>
      </div>
    </div>
  );
}

/** A non-interactive card (front only), e.g. a binder sleeve. */
export function StaticCard(p: PlayerCardProps & { className?: string }) {
  const style = { "--tc1": p.primary, "--tc2": p.secondary, ...layoutStyle(p.layout, p.frameArt) } as React.CSSProperties;
  return (
    <div className={`pcard static t-${CARD_TIER[p.dev] ?? "normal"} ${layoutClasses(p.layout, p.frameArt)} ${p.className ?? ""}`} style={style}>
      <div className="pcard-face pcard-front"><CardFrontInner {...p} /></div>
    </div>
  );
}

export function Nameplate({ first, last, small = false, rookie = false }: { first: string; last: string; small?: boolean; rookie?: boolean }) {
  return (
    <div className={`pcard-name ${small ? "small" : ""}`}>
      <span className="first">{first}</span>
      <span className="last">{last}</span>
      {rookie && <span className="pcard-ribbon">Rookie edition</span>}
    </div>
  );
}
