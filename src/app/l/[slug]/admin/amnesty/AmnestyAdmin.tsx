"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { money } from "@/lib/league/format";
import { amnestyMoney, amnestyPlan, amnestyRecipe } from "@/lib/league/amnesty";
import type { AmnestyPlayer, AmnestyTeam } from "@/lib/league/amnestyData";

const input = (p: AmnestyPlayer) => ({ capHit: p.c.capHit, pen: p.c.pen, bonus: p.bonus, hits: p.hits, dead: p.dead, ps: p.ps });

export function AmnestyAdmin({ slug, year, years, players, teams, initial, syncedAt }: {
  slug: string; year: number; years: number[]; players: AmnestyPlayer[]; teams: AmnestyTeam[]; initial: number | null; syncedAt: string;
}) {
  const teamById = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);
  const [q, setQ] = useState("");
  const [id, setId] = useState<number | null>(players.some((p) => p.id === initial) ? initial : null);
  const [override, setOverride] = useState("");
  const p = id ? players.find((x) => x.id === id) ?? null : null;

  useEffect(() => {
    window.history.replaceState(null, "", `/l/${slug}/admin/amnesty${id ? `?player=${id}` : ""}`);
    setOverride("");
  }, [id, slug]);

  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (s.length < 2) return [];
    return players
      .filter((x) => x.n.toLowerCase().includes(s) || (teamById.get(x.t)?.abbr.toLowerCase() === s))
      .sort((a, b) => b.c.pen - a.c.pen)
      .slice(0, 12);
  }, [q, players, teamById]);

  const team = p ? teamById.get(p.t) : undefined;
  const typed = Number(override.replace(/[^0-9.]/g, ""));
  const penOverride = override.trim() && typed > 0 ? Math.round((override.toLowerCase().includes("k") ? typed * 1e3 : typed < 1000 ? typed * 1e6 : typed)) : undefined;
  const plan = p ? amnestyPlan(input(p), { penalty: penOverride, space: team?.space, year }) : null;
  const recipe = plan ? amnestyRecipe(plan.target) : null;
  const n = p ? Math.max(p.c.yearsLeft, p.dead.reduce((m, x, i) => (x > 0 ? i + 1 : m), 0), 2) : 0;
  const shown = years.slice(0, Math.min(years.length, n));

  return (
    <>
      <div className="amn-search">
        <label htmlFor="amn-q" className="small strong">Find a player</label>
        <input id="amn-q" className="trade-filter" placeholder="Name, or a team like DAL" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
        {matches.length > 0 && (
          <ul className="amn-results" role="listbox">
            {matches.map((x) => (
              <li key={x.id}>
                <button type="button" onClick={() => { setId(x.id); setQ(""); }}>
                  <span><strong>{x.n}</strong> <span className="muted small">{x.pos} · {teamById.get(x.t)?.abbr} · {x.c.yearsLeft}/{x.c.length} yrs</span></span>
                  <span className="small">{x.c.pen > 0 ? `${money(x.c.pen)} penalty` : <span className="muted">no penalty</span>}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {!p || !plan || !recipe ? (
        <p className="muted">Pick a player to see his contract and the amnesty steps. Each team&apos;s Cap tab › Amnesty lists who it helps most.</p>
      ) : (
        <>
          <div className="section-head"><h3>{p.n} <span className="muted small">{p.pos} · {team?.name} · {p.age} yrs old · {p.ovr} OVR{p.ps ? " · practice squad" : ""}</span></h3></div>

          <section className="panel">
            <h4>Current contract <span className="muted small">from the last sync ({syncedAt})</span></h4>
            <div className="stat-tiles">
              <Tile label="Length / left" value={`${p.c.length} / ${p.c.yearsLeft}`} />
              <Tile label="Total value" value={money(p.c.salary + p.c.bonus)} sub={`${money(p.c.salary)} salary + ${money(p.c.bonus)} bonus`} />
              <Tile label={`Cap hit ${year}`} value={money(p.c.capHit)} />
              <Tile label="Penalty if cut today" value={money(p.c.pen)} sub={`saves ${money(p.c.saves)}`} />
            </div>
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr><th>Season</th><th className="num">Cap hit</th><th className="num">Bonus part</th><th className="num">Void-year bonus</th></tr></thead>
                <tbody>
                  {shown.map((y, i) => (
                    <tr key={y}>
                      <td>{y}{i === 0 ? " (now)" : ""}{i >= p.c.yearsLeft && p.dead[i] > 0 ? " · void" : ""}</td>
                      <td className="num">{p.hits[i] ? money(p.hits[i]) : "—"}{i > 0 && p.hits[i] ? <span className="muted small"> proj.</span> : null}</td>
                      <td className="num">{p.bonus[i] ? money(p.bonus[i]) : "—"}</td>
                      <td className="num">{p.dead[i] ? money(p.dead[i]) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="hint">Later seasons are the site&apos;s projection; this season&apos;s cap hit and the penalty are Madden&apos;s own numbers. The amnesty only uses Madden&apos;s penalty, so the projection can&apos;t throw it off.</p>
          </section>

          <section className="panel">
            <h4>Step 1 · Confirm today&apos;s penalty in Madden</h4>
            <p className="small">Open his release screen in Madden (don&apos;t confirm) or the team cap table&apos;s PENALTY column. It should read <strong>{money(p.c.pen)}</strong>. If his contract changed since the last sync, type Madden&apos;s number here:</p>
            <div className="amn-override">
              <input className="trade-filter" inputMode="decimal" placeholder={`e.g. ${(p.c.pen / 1e6).toFixed(2)}M`} value={override} onChange={(e) => setOverride(e.target.value)} />
              {penOverride != null && <span className="small">Using <strong>{money(penOverride)}</strong> <button type="button" className="btn-link" onClick={() => setOverride("")}>reset</button></span>}
            </div>
            <div className="penalty-split small">
              Penalty {money(plan.pen)} = {money(plan.breakdown.bonusLeft)} bonus not yet charged
              {plan.breakdown.voidBonus > 0 && <> + {money(plan.breakdown.voidBonus)} void-year bonus</>}
              {plan.breakdown.other > 0 && <> + {money(plan.breakdown.other)} guaranteed salary / older-deal money</>}.
              {" "}A normal cut charges {money(plan.normal[0])} in {year}{plan.normal[1] > 0 ? ` and ${money(plan.normal[1])} in ${year + 1}` : ""}.
            </div>
          </section>

          {plan.pen <= 0 ? (
            <section className="panel"><p>{plan.flags[0]?.text}</p></section>
          ) : (
            <>
              <section className="panel amn-target">
                <h4>Step 2 · The amnesty</h4>
                <div className="stat-tiles">
                  <Tile label={`Team pays (${year} only)`} value={amnestyMoney(plan.target)} sub={`50% of ${money(plan.pen)}`} />
                  <Tile label="Dead money saved" value={amnestyMoney(plan.savedVsCut)} sub="vs a normal cut" />
                  <Tile label={`${year} cap space`} value={signed(plan.amnestyDelta[0])} sub={`normal cut ${signed(plan.cutDelta[0])}`} />
                  <Tile label={`${year + 1} cap space`} value={signed(plan.amnestyDelta[1])} sub={`normal cut ${signed(plan.cutDelta[1])}`} />
                </div>
                {plan.flags.length > 0 && <ul className="amn-flags">{plan.flags.map((f) => <li key={f.kind} className={`amn-flag amn-${f.kind}`}>{f.text}</li>)}</ul>}
              </section>

              <section className="panel">
                <h4>Step 3 · Rebuild his contract (commissioner)</h4>
                <p className="small">In Madden: Roster › {p.n} › <strong>Edit Player</strong> › <strong>Contract</strong>. Set:</p>
                <table className="tbl amn-recipe"><tbody>
                  {recipe.fields.map((f) => <tr key={f.field}><th scope="row">{f.field}</th><td className="strong">{f.value}</td></tr>)}
                </tbody></table>
                <p className="small">Save. A 1-year deal charges its whole bonus this season, so all of the {money(plan.target)} lands in {year} and nothing carries into {year + 1}.</p>
              </section>

              <section className="panel">
                <h4>Step 4 · Check the card before cutting</h4>
                <p className="small">Open his release screen (or the cap table) and check, where S is the salary you set:</p>
                <table className="tbl amn-recipe"><tbody>
                  {recipe.checks.map((c) => <tr key={c.label}><th scope="row">{c.label}</th><td className="strong">{c.expect}</td></tr>)}
                </tbody></table>
                <details className="trade-detail">
                  <summary>If a number is off</summary>
                  <ul className="small">
                    <li><strong>Cap hit lower than S + {amnestyMoney(plan.target)}:</strong> void years are still on the deal, spreading the bonus into later seasons. Set void years to 0 (or length 1 again) and save.</li>
                    <li><strong>Penalty higher than {amnestyMoney(plan.target)}:</strong> guaranteed salary or an older deal&apos;s bonus survived the edit. Set guaranteed years to 0. If it&apos;s still high by X, lower the Signing Bonus by X so the penalty reads {amnestyMoney(plan.target)}, and note it, since that leftover may land in {year + 1}.</li>
                    <li><strong>The bonus slider won&apos;t land on {amnestyMoney(plan.target)}:</strong> use the closest value it allows and tell the league the difference.</li>
                    <li><strong>Madden crashes on the edit:</strong> a known Madden 27 bug with some very large contracts. Try once more; if it repeats, the league decides another way.</li>
                  </ul>
                </details>
              </section>

              <section className="panel">
                <h4>Step 5 · The manager cuts him</h4>
                <p className="small">Release screen: penalty {amnestyMoney(plan.target)}, all in {year}. After the next sync he shows in Transactions as a cut.</p>
              </section>
            </>
          )}
          {team && <p className="small"><Link href={`/l/${slug}/teams/${team.abbr.toLowerCase()}?tab=cap&view=amnesty`}>{team.name}: everyone on the roster</Link></p>}
        </>
      )}
    </>
  );
}

const signed = (n: number) => (n > 0 ? "+" : n < 0 ? "−" : "") + money(Math.abs(n));

function Tile({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="tile">
      <div className="tile-label">{label}</div>
      <div className="tile-value">{value}</div>
      {sub && <div className="tile-sub">{sub}</div>}
    </div>
  );
}
