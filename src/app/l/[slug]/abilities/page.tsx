import type { Metadata } from "next";
import Link from "next/link";
import { getLeagueData } from "@/lib/league/load";
import { ABILITIES, abilityKey, abilityPositions, leagueEligibility } from "@/lib/league/abilities";
import { NoData } from "@/components/league/bits";

export const metadata: Metadata = { title: "Abilities" };
type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ q?: string; pos?: string; kind?: string }> };

const POS = ["QB", "HB", "FB", "WR", "TE", "OT", "OG", "C", "EDGE", "DT", "MIKE", "OLB", "CB", "S", "K", "P"];

export default async function AbilitiesIndex({ params, searchParams }: Props) {
  const { slug } = await params;
  const { q = "", pos = "", kind = "" } = await searchParams;
  const d = await getLeagueData(slug);
  if (!d) return <NoData />;
  const elig = leagueEligibility(d);
  const ready = elig.size > 0;
  const has = new Map<string, number>(), can = new Map<string, number>();
  for (const p of d.players) if (!p.gone) for (const a of p.abilities) { const k = abilityKey(a.title); has.set(k, (has.get(k) || 0) + 1); }
  for (const list of elig.values()) for (const e of list) if (!e.has) can.set(e.ability.key, (can.get(e.ability.key) || 0) + 1);
  const needle = q.trim().toLowerCase();
  const rows = Object.values(ABILITIES)
    .map((a) => ({ a, pos: abilityPositions(a) }))
    .filter(({ a, pos: ps }) => (!needle || a.title.toLowerCase().includes(needle)) && (!pos || ps.includes(pos))
      && (!kind || (kind === "xf" ? a.kind === "X-Factor" : a.kind !== "X-Factor")))
    .sort((x, y) => x.a.title.localeCompare(y.a.title));
  const href = (o: Record<string, string>) => {
    const sp = new URLSearchParams({ ...(q && { q }), ...(pos && { pos }), ...(kind && { kind }), ...o });
    for (const [k, v] of [...sp.entries()]) if (!v) sp.delete(k);
    const s = sp.toString(); return `/l/${slug}/abilities${s ? `?${s}` : ""}`;
  };
  return (
    <main className="page league-page">
      <div className="wrap">
        <h2>Abilities</h2>
        <p className="muted" style={{ maxWidth: "70ch" }}>Every Madden 27 franchise ability: what it does in the game, what it takes to earn each tier, and who in this league has it or qualifies for it.</p>
        <div className="filters">
          <nav className="week-chips" aria-label="Position">
            <Link href={href({ pos: "" })} aria-current={!pos ? "page" : undefined}>All</Link>
            {POS.map((p) => <Link key={p} href={href({ pos: p })} aria-current={pos === p ? "page" : undefined}>{p}</Link>)}
          </nav>
          <div className="filter-row">
            <nav className="seg" aria-label="Type" style={{ marginBottom: 0 }}>
              <Link href={href({ kind: "" })} aria-current={!kind ? "page" : undefined}>All</Link>
              <Link href={href({ kind: "ss" })} aria-current={kind === "ss" ? "page" : undefined}>Superstar</Link>
              <Link href={href({ kind: "xf" })} aria-current={kind === "xf" ? "page" : undefined}>X-Factor</Link>
            </nav>
            <form method="get" action={`/l/${slug}/abilities`} className="search-form" role="search">
              {pos && <input type="hidden" name="pos" value={pos} />}
              {kind && <input type="hidden" name="kind" value={kind} />}
              <input type="search" name="q" defaultValue={q} placeholder="Find an ability" aria-label="Find an ability" />
            </form>
          </div>
        </div>
        <div className="panel tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Ability</th><th className="hide-sm">Type</th><th>Positions</th><th className="num">Have it</th>{ready && <th className="num">Eligible</th>}</tr></thead>
            <tbody>
              {rows.map(({ a, pos: ps }) => (
                <tr key={a.key}>
                  <td><Link href={`/l/${slug}/abilities/${a.key}`} className="strong">{a.title}</Link></td>
                  <td className="hide-sm">{a.kind === "X-Factor" ? <span className="tier tier-x-factor">X-Factor</span> : <span className="muted">Superstar</span>}</td>
                  <td className="small">{ps.length ? ps.join(", ") : <span className="muted">not listed</span>}</td>
                  <td className="num">{has.get(a.key) || <span className="muted">0</span>}</td>
                  {ready && <td className="num">{can.get(a.key) || <span className="muted">0</span>}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="hint">
          &quot;Eligible&quot; counts players who meet every requirement but don&apos;t have the ability yet.
          {!ready && " Eligibility needs player ratings, which arrive with this league's next sync."} Requirements: Madden School. Mechanics: ClutchTrait.
        </p>
      </div>
    </main>
  );
}
