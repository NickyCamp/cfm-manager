// Card front, shared by the flippable PlayerCard (player pages) and the static
// cards in the team binder and top-players stack. No hooks: works on the server.
import type { CardStat } from "@/lib/league/cardStats";

export type PlayerCardProps = {
  first: string;
  last: string;
  pos: string;
  jersey: number;
  ovr: number;
  dev: 0 | 1 | 2 | 3;
  rookie: boolean;
  teamAbbr: string;
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
  stats: CardStat[];
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
/** The ability's name stacked word by word inside its circle, sized so the longest word fits. */
function AbilityName({ title }: { title: string }) {
  const words = title.replace(/[^A-Za-z0-9'& -]/g, " ").split(/[\s-]+/).filter(Boolean);
  const longest = Math.max(4, ...words.map((w) => w.length));
  const size = Math.min(2.6, 18.5 / longest) - (words.length > 2 ? 0.2 : 0);
  return <span className="abil-name" style={{ fontSize: `${size.toFixed(2)}cqw` }}>{words.map((w, i) => <span key={i}>{w}</span>)}</span>;
}

export function CardFrontInner(p: Pick<PlayerCardProps, "first" | "last" | "pos" | "jersey" | "ovr" | "rookie" | "teamAbbr" | "art" | "cutout" | "abilities">) {
  return (
    <div className="pcard-inner">
      <div className={`pcard-art ${p.art ? "has-img" : ""} ${p.art && p.cutout ? "cutout" : ""}`}>
        {(!p.art || p.cutout) && <div className="pcard-ph" aria-hidden><span>{p.jersey}</span></div>}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {p.art && <img src={p.art} alt="" loading="lazy" />}
      </div>
      <div className="pcard-shade" />
      <div className="pcard-jersey">#{p.jersey}</div>
      <div className="pcard-side">
        <b className={`ovr ${p.ovr >= 99 ? "ovr-99" : ""}`}>{p.ovr}</b>
        <span className="pos">{p.pos}</span>
        <span className="team">{p.teamAbbr}</span>
        {sortAbilities(p.abilities).slice(0, 5).map((a) => (
          <span key={a.title} className={`abil ab-${tierClass(a.tier)}`} title={`${a.title} (${tierClass(a.tier) === "single" ? "X-Factor" : a.tier})`}><AbilityName title={a.title} /></span>
        ))}
      </div>
      <Nameplate first={p.first} last={p.last} rookie={p.rookie} />
      <div className="pcard-foil" /><div className="pcard-glare" />
    </div>
  );
}

/** A non-interactive card (front only), e.g. a binder sleeve. */
export function StaticCard(p: PlayerCardProps & { className?: string }) {
  const style = { "--tc1": p.primary, "--tc2": p.secondary } as React.CSSProperties;
  return (
    <div className={`pcard static t-${CARD_TIER[p.dev] ?? "normal"} ${p.className ?? ""}`} style={style}>
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
