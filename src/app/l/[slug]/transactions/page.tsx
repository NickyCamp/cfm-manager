import type { Metadata } from "next";
import Link from "next/link";
import { getLeagueData, getLeagueHistory } from "@/lib/league/load";
import { indexes } from "@/lib/league/derive";
import { money } from "@/lib/league/format";
import { RATING_KEYS } from "@/lib/league/ratings";
import { tradeKey, weekKey, weekOrder, type C, type TradePicks, type TxEvent, type TxKind } from "@/lib/league/history";
import { isCommissioner, viewer } from "@/lib/marketStore";
import { leagueBySlug } from "@/lib/discord/links";
import { TradePicksEditor } from "@/components/league/TradePicksEditor";
import { DEV_LABEL, type Player, type Team } from "@/lib/league/types";
import { NoData, TeamBadge } from "@/components/league/bits";

export const metadata: Metadata = { title: "Transactions" };
type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ cat?: string; team?: string; all?: string }> };

const CATS = [
  ["moves", "All moves", ["extended", "restructured", "trade", "signed", "released", "retired"]],
  ["extensions", "Extensions", ["extended"]],
  ["restructures", "Restructures", ["restructured"]],
  ["trades", "Trades", ["trade"]],
  ["signings", "Signings", ["signed"]],
  ["cuts", "Cuts", ["released"]],
  ["dev", "Dev changes", ["dev"]],
  ["ratings", "Rating changes", ["rating"]],
  ["positions", "Position changes", ["position"]],
] as const satisfies readonly (readonly [string, string, readonly TxKind[]])[];

const BADGE: Partial<Record<TxKind, string>> = {
  extended: "Extension", restructured: "Restructure", trade: "Trade", signed: "Signed", released: "Cut", retired: "Retired", position: "Position",
};
const RATING_LIMIT = 40;

export default async function Transactions({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;
  const [d, hist, v, lg] = await Promise.all([getLeagueData(slug), getLeagueHistory(slug), viewer(slug).catch(() => null), leagueBySlug(slug).catch(() => null)]);
  if (!d) return <NoData />;
  const commish = Boolean(v?.leagueId && v.userId && (await isCommissioner(v.leagueId, v.userId).catch(() => false)));
  const tradePicks = ((lg?.settings?.tradePicks as TradePicks | undefined) || {});
  const pk = { slug, commish, tradePicks, firstYear: d.season.capYear ?? d.season.year };
  const { teams } = indexes(d);
  const byAbbr = new Map(d.teams.map((t) => [t.abbr.toLowerCase(), t]));
  const team = sp.team ? byAbbr.get(sp.team.toLowerCase()) : undefined;
  const cat = CATS.find(([k]) => k === sp.cat) ?? CATS[0];
  const showAll = sp.all === "1";
  const players = new Map(d.players.map((p) => [p.id, p]));

  const href = (o: { cat?: string; team?: string | null; all?: boolean }) => {
    const q = new URLSearchParams();
    const c = o.cat ?? cat[0];
    if (c !== "moves") q.set("cat", c);
    const t = o.team === undefined ? team?.abbr.toLowerCase() : o.team;
    if (t) q.set("team", t);
    if (o.all ?? showAll) q.set("all", "1");
    const s = q.toString();
    return `/l/${slug}/transactions${s ? `?${s}` : ""}`;
  };

  const kinds = new Set<TxKind>(cat[2]);
  const all = hist?.events ?? [];
  const touches = (e: TxEvent) => !team || e.from === team.id || e.to === team.id || (e.deal?.teams.includes(team.id) ?? false);
  const events = all.filter((e) => kinds.has(e.kind) && touches(e));
  const counts = Object.fromEntries(CATS.map(([k, , ks]) => [k, all.filter((e) => (ks as readonly TxKind[]).includes(e.kind) && touches(e)).length]));

  // Newest league week first.
  const weeks = new Map<string, { w: TxEvent["wk"]; list: TxEvent[] }>();
  for (const e of events) {
    const k = weekKey(e.wk);
    if (!weeks.has(k)) weeks.set(k, { w: e.wk, list: [] });
    weeks.get(k)!.list.push(e);
  }
  const ordered = [...weeks.values()].sort((a, b) => weekOrder(b.w) - weekOrder(a.w));

  return (
    <main className="page league-page">
      <div className="wrap">
        <h2>Transactions</h2>
        <p className="muted" style={{ maxWidth: "70ch" }}>
          Every move CFM Manager has seen, newest first: extensions, restructures, trades, signings and cuts, plus dev trait, overall and position changes.
          EA only shows the league as it is now, so moves are found by comparing each sync with the last
          {hist ? <> (tracked since {fmtDate(hist.trackedSince)})</> : null}.
        </p>

        <div className="filters">
          <nav className="week-chips" aria-label="Category">
            {CATS.map(([k, label]) => (
              <Link key={k} href={href({ cat: k, all: false })} aria-current={k === cat[0] ? "page" : undefined}>
                {label} <span className="muted small">{counts[k]}</span>
              </Link>
            ))}
          </nav>
          <div className="filter-row">
            <form method="get" action={`/l/${slug}/transactions`} className="search-form tx-team-form">
              {cat[0] !== "moves" && <input type="hidden" name="cat" value={cat[0]} />}
              <select name="team" defaultValue={team?.abbr.toLowerCase() ?? ""} aria-label="Team">
                <option value="">All teams</option>
                {[...d.teams].sort((a, b) => a.city.localeCompare(b.city)).map((t) => <option key={t.id} value={t.abbr.toLowerCase()}>{t.city} {t.name}</option>)}
              </select>
              <button type="submit" className="btn btn-quiet">Show</button>
            </form>
            {team && <Link className="toggle-link" href={href({ team: null })}>Clear team</Link>}
          </div>
        </div>

        {!hist && <div className="panel"><p>The transaction log starts with the next sync. Moves show up here from then on.</p></div>}
        {hist && ordered.length === 0 && <div className="panel"><p className="muted">Nothing here yet{team ? ` for the ${team.name}` : ""}.</p></div>}

        {ordered.map(({ w, list }) => (
          <section className="panel" key={weekKey(w)}>
            <h3 className="tx-week">{w.year} {w.title} <span className="muted small">{list.length}</span></h3>
            {cat[0] === "ratings" ? <RatingWeek slug={slug} list={list} players={players} teams={teams} showAll={showAll} moreHref={href({ all: true })} />
              : cat[0] === "dev" ? <DevWeek slug={slug} list={list} players={players} teams={teams} />
              : <MoveList slug={slug} list={list} players={players} teams={teams} pk={pk} />}
          </section>
        ))}

        <p className="hint" style={{ maxWidth: "76ch" }}>
          A restructure turns salary into signing bonus: the cap hit drops in the season it&apos;s done and the money comes back spread over the
          rest of the deal&apos;s bonus window (up to 5 seasons, and into a void year if he&apos;s in his last season). The team Cap tabs and the
          contract tool project restructured deals that way. EA&apos;s data has no draft picks, so a synced trade shows only its players until a
          commissioner adds its picks (Add picks on the trade). Trades imported from the old NCL site&apos;s MyMadden log already have theirs.
        </p>
      </div>
    </main>
  );
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" });
}

function Who({ slug, e, players }: { slug: string; e: TxEvent; players: Map<number, Player> }) {
  const p = e.p ? players.get(e.p) : undefined;
  const name = p ? <Link href={`/l/${slug}/players/${p.id}`}>{e.name}</Link> : <span>{e.name}</span>;
  return (
    <span className="tx-who">
      <strong>{name}</strong> <span className="muted small">{e.pos}{e.ovr ? ` · ${e.ovr}` : ""}{e.age ? ` · ${e.age} yrs` : ""}{e.dev ? ` · ${DEV_LABEL[e.dev]}` : ""}</span>
    </span>
  );
}

const deal = (c: C) => `${c[0]} yr${c[0] === 1 ? "" : "s"}, ${money(c[2] + c[3])} (${money(c[3])} bonus)`;

function Detail({ e }: { e: TxEvent }) {
  const a = e.after, b = e.before;
  if (e.kind === "restructured" && a && b) {
    const x = b[2] - a[2];
    return <span>Turned <strong>{money(x)}</strong> of salary into bonus. {e.caps?.[1]} cap hit <strong>{money(a[4])}</strong>{e.caps?.[0] === e.caps?.[1] ? <> (was {money(b[4])})</> : null}; {a[1]} yr{a[1] === 1 ? "" : "s"} left.</span>;
  }
  if (e.kind === "extended" && a) {
    return <span>{deal(a)}, {money((a[2] + a[3]) / Math.max(1, a[0]))}/yr; {e.caps?.[1]} cap hit <strong>{money(a[4])}</strong>{b ? <span className="muted"> · was {deal(b)} with {b[1]} left</span> : null}</span>;
  }
  if (e.kind === "position" && e.move) {
    return <span>{e.move[0]} → <strong>{e.move[1]}</strong>{e.snap ? <span className="muted"> · {e.snap.wt} lbs{e.snap.r ? `, ${e.snap.r[RATING_KEYS.indexOf("speedRating")]} SPD` : ""}</span> : null}</span>;
  }
  if (e.kind === "signed" && a) return <span>{deal(a)}; cap hit <strong>{money(a[4])}</strong></span>;
  if ((e.kind === "released" || e.kind === "retired") && b) return <span className="muted">Was on {deal(b)}, {b[1]} yr{b[1] === 1 ? "" : "s"} left, {money(b[4])} cap hit</span>;
  return null;
}

type PickProps = { slug: string; commish: boolean; tradePicks: TradePicks; firstYear: number };

function MoveList({ slug, list, players, teams, pk }: { slug: string; list: TxEvent[]; players: Map<number, Player>; teams: Map<number, Team>; pk: PickProps }) {
  // Players traded between the same two teams in the same sync are one trade.
  const trades = new Map<string, TxEvent[]>();
  const rows: (TxEvent | TxEvent[])[] = [];
  for (const e of list) {
    if (e.kind === "trade" && !e.deal) {
      const k = tradeKey(e);
      if (!trades.has(k)) { trades.set(k, []); rows.push(trades.get(k)!); }
      trades.get(k)!.push(e);
    } else rows.push(e);
  }
  const at = (r: TxEvent | TxEvent[]) => (Array.isArray(r) ? r[0].at : r.at) || "";
  rows.sort((x, y) => at(y).localeCompare(at(x)));
  return (
    <ul className="tx-list">
      {rows.map((r, i) => Array.isArray(r) ? <TradeRow key={i} slug={slug} list={r} players={players} teams={teams} pk={pk} />
        : r.deal ? <SeedTrade key={r.id} e={r} teams={teams} />
        : (
          <li key={r.id} className="tx-row">
            <span className={`tx-badge k-${r.kind}`}>{BADGE[r.kind] ?? r.kind}</span>
            <span className="tx-teams">
              {r.from ? <TeamBadge team={teams.get(r.from)} size={20} /> : null}
              {r.from && r.to ? <span aria-hidden>→</span> : null}
              {r.to ? <TeamBadge team={teams.get(r.to)} size={20} /> : null}
            </span>
            <span className="tx-body"><Who slug={slug} e={r} players={players} /> <Detail e={r} /></span>
            {r.at && <span className="tx-time muted small">{fmtDate(r.at)}</span>}
          </li>
        ))}
    </ul>
  );
}

function TradeRow({ slug, list, players, teams, pk }: { slug: string; list: TxEvent[]; players: Map<number, Player>; teams: Map<number, Team>; pk: PickProps }) {
  const sides = [...new Set(list.flatMap((e) => [e.from!, e.to!]))];
  const key = tradeKey(list[0]);
  const picks = pk.tradePicks[key] || {};
  return (
    <li className="tx-row tx-trade">
      <span className="tx-badge k-trade">Trade</span>
      <div className="tx-body">
        {sides.map((t) => {
          const got = list.filter((e) => e.to === t);
          const pl = picks[String(t)] || [];
          return (
            <div key={t} className="tx-side">
              <TeamBadge team={teams.get(t)} size={20} /> <span className="muted small">got</span>{" "}
              {got.map((e, i) => <span key={e.id}>{i ? ", " : ""}<Who slug={slug} e={e} players={players} /></span>)}
              {pl.map((p, i) => <span key={p + i}>{got.length || i ? ", " : ""}<span className="muted">{p}</span></span>)}
              {!got.length && !pl.length && <span className="muted">draft picks (EA&apos;s data doesn&apos;t list picks)</span>}
            </div>
          );
        })}
        {pk.commish && <TradePicksEditor slug={pk.slug} tradeKey={key} firstYear={pk.firstYear} initial={picks}
          teams={sides.map((t) => ({ id: t, abbr: teams.get(t)?.abbr || "?" }))} allAbbrs={[...teams.values()].map((t) => t.abbr).sort()} />}
      </div>
      {list[0].at && <span className="tx-time muted small">{fmtDate(list[0].at)}</span>}
    </li>
  );
}

function SeedTrade({ e, teams }: { e: TxEvent; teams: Map<number, Team> }) {
  return (
    <li className="tx-row tx-trade">
      <span className="tx-badge k-trade">Trade</span>
      <div className="tx-body">
        {Object.entries(e.deal!.got).map(([t, items]) => (
          <div key={t} className="tx-side">
            <TeamBadge team={teams.get(Number(t))} size={20} /> <span className="muted small">got</span>{" "}
            {items.map((x, i) => <span key={i}>{i ? ", " : ""}{x.pick ? <span className="muted">{x.pick}</span> : <><strong>{x.name}</strong> <span className="muted small">{x.pos}</span></>}</span>)}
          </div>
        ))}
      </div>
    </li>
  );
}

function DevWeek({ slug, list, players, teams }: { slug: string; list: TxEvent[]; players: Map<number, Player>; teams: Map<number, Team> }) {
  const sorted = [...list].sort((a, b) => (b.change![1] - b.change![0]) - (a.change![1] - a.change![0]) || b.ovr - a.ovr);
  return (
    <ul className="tx-list">
      {sorted.map((e) => {
        const up = e.change![1] > e.change![0];
        return (
          <li key={e.id} className="tx-row">
            <span className={`tx-badge ${up ? "k-up" : "k-down"}`}>{up ? "Up" : "Down"}</span>
            <span className="tx-teams">{e.to ? <TeamBadge team={teams.get(e.to)} size={20} /> : null}</span>
            <span className="tx-body"><Who slug={slug} e={{ ...e, dev: 0 }} players={players} /> {DEV_LABEL[e.change![0]]} → <strong className={up ? "pos" : "neg"}>{DEV_LABEL[e.change![1]]}</strong></span>
          </li>
        );
      })}
    </ul>
  );
}

function RatingWeek({ slug, list, players, teams, showAll, moreHref }: {
  slug: string; list: TxEvent[]; players: Map<number, Player>; teams: Map<number, Team>; showAll: boolean; moreHref: string;
}) {
  const delta = (e: TxEvent) => e.change![1] - e.change![0];
  const up = list.filter((e) => delta(e) > 0).sort((a, b) => delta(b) - delta(a) || b.ovr - a.ovr);
  const down = list.filter((e) => delta(e) < 0).sort((a, b) => delta(a) - delta(b) || b.ovr - a.ovr);
  const col = (title: string, rows: TxEvent[]) => (
    <div className="tx-col">
      <h4>{title} <span className="muted small">{rows.length}</span></h4>
      <ul className="tx-list">
        {(showAll ? rows : rows.slice(0, RATING_LIMIT)).map((e) => (
          <li key={e.id} className="tx-row compact">
            <span className="tx-teams">{e.to ? <TeamBadge team={teams.get(e.to)} size={18} /> : null}</span>
            <span className="tx-body"><Who slug={slug} e={{ ...e, ovr: 0 }} players={players} /></span>
            <span className="tx-ovr">{e.change![0]} → <strong>{e.change![1]}</strong> <span className={delta(e) > 0 ? "pos" : "neg"}>{delta(e) > 0 ? "+" : ""}{delta(e)}</span></span>
          </li>
        ))}
      </ul>
      {!showAll && rows.length > RATING_LIMIT && <Link className="small" href={moreHref}>Show all {rows.length}</Link>}
    </div>
  );
  return <div className="tx-cols">{col("Went up", up)}{col("Went down", down)}</div>;
}
