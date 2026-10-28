import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLeagueData } from "@/lib/league/load";
import { indexes } from "@/lib/league/derive";
import { ABILITIES, abilityKey, abilityPositions, leagueEligibility } from "@/lib/league/abilities";
import { RATING_LABEL } from "@/lib/league/ratings";
import { AbilityMechanics, TierPill } from "@/components/league/AbilityInfo";
import { NoData, TeamBadge } from "@/components/league/bits";

type Props = { params: Promise<{ slug: string; key: string }>; searchParams: Promise<{ all?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { key } = await params;
  return { title: ABILITIES[key]?.title || "Ability" };
}

const POS_NAME: Record<string, string> = { LEDG: "Edge", REDG: "Edge", LT: "OT", RT: "OT", LG: "OG", RG: "OG", WILL: "OLB", SAM: "OLB", FS: "S", SS: "S" };

export default async function AbilityPage({ params, searchParams }: Props) {
  const { slug, key } = await params;
  const { all } = await searchParams;
  const a = ABILITIES[key];
  if (!a) notFound();
  const d = await getLeagueData(slug);
  if (!d) return <NoData />;
  const { teams, players } = indexes(d);
  const elig = leagueEligibility(d);

  // Requirements, grouped by the positions that share them.
  const byPos = new Map<string, typeof a.tiers>();
  for (const t of a.tiers) {
    const label = [...new Set(t.pos.map((p) => POS_NAME[p] || p))].join(", ");
    byPos.set(label, [...(byPos.get(label) || []), t]);
  }
  const reqText = (t: (typeof a.tiers)[number]) => [
    ...t.reqs.map(([type, k, min]) => type === "arch" ? `${k} rating ${min}+ (estimated)` : type === "ovr" ? `Overall ${min}+` : `${RATING_LABEL[k] || k} ${min}+`),
    t.slots ? `ability slot ${t.slots.length > 2 ? `${t.slots[0]}–${t.slots[t.slots.length - 1]}` : t.slots.join(" or ")}` : a.kind === "X-Factor" ? "X-Factor slot (X-Factor dev)" : "",
  ].filter(Boolean);

  const holders = d.players.filter((p) => !p.gone && p.abilities.some((x) => abilityKey(x.title) === a.key))
    .map((p) => ({ p, tier: p.abilities.find((x) => abilityKey(x.title) === a.key)!.tier }))
    .sort((x, y) => y.p.ovr - x.p.ovr);
  const rank = (t: string) => ({ Single: 4, Gold: 3, Silver: 2, Bronze: 1 } as Record<string, number>)[t] || 0;
  const eligible = [...elig.entries()].flatMap(([id, list]) => list.filter((e) => e.ability.key === a.key && !e.has).map((e) => ({ p: players.get(id)!, e })))
    .filter((x) => x.p && x.p.team)
    .sort((x, y) => rank(y.e.tier) - rank(x.e.tier) || y.p.ovr - x.p.ovr);
  const LIMIT = 40;
  const shown = all ? eligible : eligible.slice(0, LIMIT);
  const teamCell = (tid: number) => { const t = teams.get(tid); return t ? <Link className="team-link" href={`/l/${slug}/teams/${t.abbr.toLowerCase()}`}><TeamBadge team={t} size={18} />{t.abbr}</Link> : <span className="muted">FA</span>; };

  return (
    <main className="page league-page">
      <div className="wrap">
        <p className="small"><Link href={`/l/${slug}/abilities`}>← All abilities</Link></p>
        <h2>{a.title} {a.kind === "X-Factor" && <span className="tier tier-x-factor">X-Factor</span>}</h2>
        <p className="muted">{a.side === "defense" ? "Defense" : "Offense"} · {abilityPositions(a).join(", ") || "positions not listed"}</p>

        <section className="panel">
          <h3>What it does</h3>
          <AbilityMechanics a={a} slug={slug} />
        </section>

        <section className="panel">
          <h3>What each tier needs</h3>
          {a.tiers.length === 0 ? <p className="muted">No franchise requirements on file for this ability.</p> : (
            [...byPos.entries()].map(([label, tiers]) => (
              <div className="tbl-wrap" key={label}>
                <table className="tbl">
                  <caption>{label}</caption>
                  <tbody>{tiers.map((t, i) => <tr key={i}><th scope="row" style={{ width: 90 }}><TierPill tier={t.tier} /></th><td>{reqText(t).join(" · ")}</td></tr>)}</tbody>
                </table>
              </div>
            ))
          )}
          {a.tiers.length > 0 && <p className="hint">Each tier includes the one before it. Archetype ratings aren&apos;t in EA&apos;s data, so the site estimates them from a player&apos;s ratings.</p>}
        </section>

        <section className="panel tbl-wrap">
          <table className="tbl">
            <caption>Who has it <span className="muted">{holders.length}</span></caption>
            {holders.length > 0 && <thead><tr><th>Player</th><th>Team</th><th className="num">OVR</th><th>Tier</th></tr></thead>}
            <tbody>
              {holders.length === 0 ? <tr><td className="muted">Nobody in this league yet.</td></tr> : holders.map(({ p, tier }) => (
                <tr key={p.id}><td><Link href={`/l/${slug}/players/${p.id}`}>{p.first} {p.last}</Link> <span className="muted small">{p.pos}</span></td><td>{teamCell(p.team)}</td><td className="num">{p.ovr}</td><td><TierPill tier={tier} /></td></tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="panel tbl-wrap">
          <table className="tbl">
            <caption>Eligible on rosters <span className="muted">{eligible.length} meet every requirement and don&apos;t have it yet</span></caption>
            {eligible.length > 0 && <thead><tr><th>Player</th><th>Team</th><th className="num">OVR</th><th>Qualifies for</th><th className="hide-sm">Next tier needs</th></tr></thead>}
            <tbody>
              {elig.size === 0 ? <tr><td className="muted">Player ratings arrive with this league&apos;s next sync.</td></tr>
                : eligible.length === 0 ? <tr><td className="muted">Nobody on a roster qualifies right now.</td></tr>
                : shown.map(({ p, e }) => (
                  <tr key={p.id}>
                    <td><Link href={`/l/${slug}/players/${p.id}`}>{p.first} {p.last}</Link> <span className="muted small">{p.pos}</span></td>
                    <td>{teamCell(p.team)}</td>
                    <td className="num">{p.ovr}</td>
                    <td><TierPill tier={e.tier} />{e.borderline && <span className="tag">close call</span>}</td>
                    <td className="hide-sm small muted">{e.next ? `${e.next.tier}: ${e.next.missing.map((m) => `${m.label}${m.min ? ` ${m.min}` : ""}${m.have != null ? ` (has ${m.have})` : ""}`).join(", ")}` : "—"}</td>
                  </tr>
                ))}
            </tbody>
          </table>
          {!all && eligible.length > LIMIT && <p className="small"><Link href={`/l/${slug}/abilities/${a.key}?all=1`}>Show all {eligible.length}</Link></p>}
        </section>
      </div>
    </main>
  );
}
