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
  abilities: { title: string; tier: string }[];
  stats: CardStat[];
};

export const CARD_TIER = ["normal", "star", "super", "xf"] as const;
const TIER_RANK: Record<string, number> = { single: 0, gold: 1, silver: 2, bronze: 3 };
export const tierClass = (t: string) => (t.toLowerCase() in TIER_RANK ? t.toLowerCase() : "bronze");
export const sortAbilities = (a: { title: string; tier: string }[]) =>
  [...a].sort((x, y) => (TIER_RANK[tierClass(x.tier)] ?? 9) - (TIER_RANK[tierClass(y.tier)] ?? 9));
const initials = (t: string) => t.replace(/[^A-Za-z0-9 ]/g, " ").split(/\s+/).filter(Boolean).map((w) => w[0]).join("").slice(0, 3).toUpperCase();

export function CardFrontInner(p: Pick<PlayerCardProps, "first" | "last" | "pos" | "jersey" | "ovr" | "rookie" | "teamAbbr" | "art" | "abilities">) {
  return (
    <div className="pcard-inner">
      <div className={`pcard-art ${p.art ? "has-img" : ""}`}>
        {p.art
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={p.art} alt="" loading="lazy" />
          : <div className="pcard-ph" aria-hidden><span>{p.jersey}</span></div>}
      </div>
      <div className="pcard-shade" />
      <div className="pcard-jersey">#{p.jersey}</div>
      <div className="pcard-side">
        <b className={`ovr ${p.ovr >= 99 ? "ovr-99" : ""}`}>{p.ovr}</b>
        <span className="pos">{p.pos}</span>
        <span className="team">{p.teamAbbr}</span>
        {sortAbilities(p.abilities).slice(0, 5).map((a) => (
          <span key={a.title} className={`abil ab-${tierClass(a.tier)}`} title={`${a.title} (${a.tier === "Single" ? "X-Factor" : a.tier})`}>{initials(a.title)}</span>
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
