// Card front, shared by the flippable PlayerCard (player pages) and the static
// cards in the team binder and top-players stack. No hooks: works on the server.
import type { CardStat, SeasonItem } from "@/lib/league/cardStats";

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

const moneyShort = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toFixed(n >= 1e8 ? 0 : 1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}K` : `$${n}`);

/** The card back: fills the whole card like a real trading card's back. */
export function CardBackInner(p: PlayerCardProps) {
  return (
    <div className="pcard-inner pcard-inner-back">
      <div className="kb-head">
        <div className="kb-name">
          <span className="first">{p.first}</span>
          <span className="last">{p.last}</span>
          <span className="kb-sub"><span className="team">{p.teamAbbr}</span>{p.pos} · #{p.jersey} · {p.exp}</span>
        </div>
        <div className="kb-ovr"><b className={p.ovr >= 99 ? "ovr-99" : ""}>{p.ovr}</b><span>OVR</span></div>
      </div>
      <div className="kb-body">
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
