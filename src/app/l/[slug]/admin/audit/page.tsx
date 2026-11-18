import type { Metadata } from "next";
import Link from "next/link";
import { getLeagueData, getLeagueHistory } from "@/lib/league/load";
import { isCommissioner, viewer } from "@/lib/marketStore";
import { leagueBySlug } from "@/lib/discord/links";
import {
  auditAbilities, auditGames, auditPlayers, auditRulesOf, knownAbilityTitles, parseAbilityRules, parsePositionRules,
  unknownAbilityNames, type AuditResult,
} from "@/lib/league/audit";
import abilitiesData from "@/lib/league/abilities-data.json";
import { AuditRulesForm } from "@/components/league/AuditRulesForm";
import { TeamBadge } from "@/components/league/bits";

export const metadata: Metadata = { title: "Rule audits" };
type Props = { params: Promise<{ slug: string }> };

// Rule audits (Nick, 2026-11-18): the commissioner edits the league's rules here; /audit in Discord
// and the results below check them against the latest sync.
export default async function AuditPage({ params }: Props) {
  const { slug } = await params;
  const [v, d, h, lg] = await Promise.all([viewer(slug), getLeagueData(slug), getLeagueHistory(slug), leagueBySlug(slug)]);
  const commish = Boolean(v.leagueId && v.userId && (await isCommissioner(v.leagueId, v.userId).catch(() => false)));
  if (!commish || !d || !lg) {
    return (
      <main className="page league-page"><div className="wrap">
        <h2>Rule audits</h2>
        <p className="muted">{!v.userId ? "Sign in to see this page." : "Only the league's commissioner can use the admin panel."}</p>
      </div></main>
    );
  }
  const rules = auditRulesOf(lg.settings);
  const base = Object.values((abilitiesData as { abilities: Record<string, { title: string }> }).abilities).map((a) => a.title);
  const titles = knownAbilityTitles(d, base);
  const unknown = unknownAbilityNames(rules.abilities, titles);
  const errors = [...parseAbilityRules(rules.abilities).errors, ...parsePositionRules(rules.positions.changes).errors];
  const results: [string, string, AuditResult][] = [
    ["abilities", "Abilities", auditAbilities(d, rules)],
    ["games", "Games", auditGames(d, rules)],
    ["players", "Players", auditPlayers(d, h, rules)],
  ];
  const teams = new Map(d.teams.map((t) => [t.id, t]));

  return (
    <main className="page league-page markets-page">
      <div className="wrap">
        <h2>Rule audits</h2>
        <p className="muted" style={{ maxWidth: "72ch" }}>
          Write the league&apos;s rules here, then run <code>/audit abilities</code>, <code>/audit games</code> or <code>/audit players</code> in Discord
          (admin role; add <code>public:True</code> to post for everyone). The results below use the latest sync ({d.season.year} {d.season.title}).
          {" "}<Link href={`/l/${slug}/admin`}>Back to Admin</Link>
        </p>

        <nav className="week-chips" aria-label="Audits">
          {results.map(([k, label, r]) => <a key={k} href={`#${k}`}>{label} <span className="muted small">{r.findings.length}</span></a>)}
          <a href="#rules">Edit rules</a>
        </nav>

        {results.map(([k, label, r]) => {
          const byTeam = new Map<number, typeof r.findings>();
          for (const f of r.findings) (byTeam.get(f.team) || byTeam.set(f.team, []).get(f.team)!).push(f);
          return (
            <section className="panel" id={k} key={k}>
              <h3>{label} <span className="muted small">{r.checked}</span></h3>
              {!r.findings.length && <p>✅ No rule breaks found.</p>}
              {[...byTeam.entries()].sort(([a], [b]) => (teams.get(a)?.abbr || "").localeCompare(teams.get(b)?.abbr || "")).map(([tid, list]) => (
                <div key={tid} className="audit-team">
                  <h4><TeamBadge team={teams.get(tid)} size={20} /> {teams.get(tid) ? `${teams.get(tid)!.city} ${teams.get(tid)!.name}` : "Unknown team"} {teams.get(tid)?.user ? <span className="muted small">{teams.get(tid)!.user}</span> : null}</h4>
                  <ul className="audit-list">
                    {list.map((f, i) => (
                      <li key={i} className={f.severity}>
                        <span aria-hidden>{f.severity === "violation" ? "🚫" : "⚠️"}</span> <strong>{f.rule}</strong>: {md(f.text)}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              {r.notes.map((n, i) => <p key={i} className="muted small">{n}</p>)}
            </section>
          );
        })}

        <section className="panel" id="rules">
          <h3>Edit rules</h3>
          {errors.length > 0 && <p className="mk-msg err">Couldn&apos;t read: {errors.join(" · ")}</p>}
          {unknown.length > 0 && (
            <p className="mk-msg err">
              Not a Madden 27 ability we know of, and nobody in the league has it, so it can&apos;t match anything yet (check the spelling): {unknown.join(", ")}
            </p>
          )}
          <AuditRulesForm slug={slug} rules={rules} titles={titles} />
        </section>
      </div>
    </main>
  );
}

/** The findings use **bold** like Discord; show it as bold here too. */
function md(text: string) {
  return text.split(/\*\*(.+?)\*\*/g).map((s, i) => (i % 2 ? <strong key={i}>{s}</strong> : s));
}
