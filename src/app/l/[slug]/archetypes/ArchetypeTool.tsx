"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { RATING_KEYS } from "@/lib/league/ratings";
import { RATING_GROUPS } from "@/lib/league/ratingGroups";
import {
  abilityEligibility, archetypeScores, bestOf, fastestPath, numberSlots, slotLayout, STORE_LOCKED, tierRank,
  type CalcAbility, type CalcArch, type CalcEligibility, type CalcShortfall, type CalcTierName, type PathTarget,
} from "@/lib/league/archetypeCalc";

export type CalcListPlayer = { id: number; n: string; pos: string; t: string; ovr: number };
export type CalcPlayer = CalcListPlayer & { age: number; dev: number; ratings: number[]; slots: number[]; held: { title: string; tier: string }[] };

const DEV = ["Normal", "Star", "Superstar", "X-Factor"];
const keyOf = (title: string) => title.toLowerCase().replace(/[^a-z0-9]/g, "");
const clamp = (n: number) => Math.max(0, Math.min(99, Math.round(n)));
const signed = (n: number, digits = 0) => (n > 0 ? "+" : n < 0 ? "−" : "±") + Math.abs(n).toFixed(digits);

export function ArchetypeTool({ slug, list, player, arch, abilities, positions, labels }: {
  slug: string; list: CalcListPlayer[]; player: CalcPlayer | null; arch: CalcArch; abilities: CalcAbility[]; positions: string[]; labels: Record<string, string>;
}) {
  const router = useRouter();
  const [query, setQuery] = useState(player?.n || "");
  const [open, setOpen] = useState(false);
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return list.filter((p) => p.n.toLowerCase().includes(q)).sort((a, b) => b.ovr - a.ovr).slice(0, 12);
  }, [query, list]);

  function choose(p: CalcListPlayer) {
    setQuery(p.n);
    setOpen(false);
    router.push(`/l/${slug}/archetypes?player=${p.id}`, { scroll: false });
  }

  return (
    <>
      <div className="panel search-panel">
        <label htmlFor="arch-search">Find a player</label>
        <div className="combo">
          <input id="arch-search" type="search" autoComplete="off" placeholder="Start typing a name"
            role="combobox" aria-expanded={open && matches.length > 0} aria-controls="arch-results"
            value={query} onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
            onKeyDown={(e) => { if (e.key === "Enter" && matches[0]) { e.preventDefault(); choose(matches[0]); } }} />
          {open && query.trim().length >= 2 && (
            <ul id="arch-results" role="listbox" className="combo-list">
              {matches.length === 0 && <li className="muted combo-empty">No players match &quot;{query}&quot;.</li>}
              {matches.map((p) => (
                <li key={p.id} role="option" aria-selected={false} onMouseDown={(e) => { e.preventDefault(); choose(p); }}>
                  <span>{p.n}</span>
                  <span className="muted small">{p.pos}, {p.ovr} OVR, {p.t}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {player ? (arch.positions[player.pos]
        ? <Calculator slug={slug} p={player} arch={arch} abilities={abilities} positions={positions} labels={labels} />
        : <p className="muted">There are no archetype formulas for {player.pos}s (kickers and punters have a single rating set), so this calculator can&apos;t project him.</p>)
        : <p className="muted">Search for anyone in the league, including free agents.</p>}
    </>
  );
}

function Calculator({ slug, p, arch, abilities, positions, labels }: {
  slug: string; p: CalcPlayer; arch: CalcArch; abilities: CalcAbility[]; positions: string[]; labels: Record<string, string>;
}) {
  const [ratings, setRatings] = useState<number[]>(p.ratings);
  const [pos, setPos] = useState(p.pos);
  const [dev, setDev] = useState(p.dev);
  const [showAll, setShowAll] = useState(false);

  const group = arch.positions[pos];
  const formulas = useMemo(() => arch.groups[group] || {}, [arch, group]);

  // Calibrate to his in-game overall: the formulas can be a point off for a few players.
  const origScores = useMemo(() => archetypeScores(arch, p.pos, p.ratings)!, [arch, p]);
  const offset = useMemo(() => p.ovr - Math.round(bestOf(origScores)[1]), [p, origScores]);
  const sameGroup = group === arch.positions[p.pos];

  const scores = useMemo(() => archetypeScores(arch, pos, ratings) || {}, [arch, pos, ratings]);
  const [bestName, bestRaw] = bestOf(scores);
  const ovr = clamp(Math.round(bestRaw) + (sameGroup ? offset : 0));

  const layout = slotLayout(dev, pos, p.slots, p.dev);
  const slots = numberSlots(layout.slots, ovr);
  const origLayout = slotLayout(p.dev, p.pos, p.slots, p.dev);

  const result = useMemo(() => abilityEligibility(abilities, { pos, ovr, dev, ratings, scores, slots: layout.slots, labels }),
    [abilities, pos, ovr, dev, ratings, scores, layout.slots, labels]);
  const before = useMemo(() => abilityEligibility(abilities, { pos: p.pos, ovr: p.ovr, dev: p.dev, ratings: p.ratings, scores: origScores, slots: origLayout.slots, labels }, 0),
    [abilities, p, origScores, origLayout.slots, labels]);
  const beforeTier = new Map(before.eligible.map((e) => [e.ability.key, e.tier]));
  const nowKeys = new Set(result.eligible.map((e) => e.ability.key));
  const lost = before.eligible.filter((e) => !nowKeys.has(e.ability.key));
  const held = new Map(p.held.map((h) => [keyOf(h.title), h.tier]));

  // Ratings that feed this position's archetypes, biggest weight in the best archetype first.
  const keyRatings = useMemo(() => {
    const max: Record<string, number> = {};
    for (const f of Object.values(formulas)) for (const [k, w] of Object.entries(f.w)) max[k] = Math.max(max[k] || 0, w);
    return Object.keys(max).filter((k) => max[k] >= 0.01)
      .sort((a, b) => (formulas[bestName]?.w[b] || 0) - (formulas[bestName]?.w[a] || 0) || max[b] - max[a]);
  }, [formulas, bestName]);
  const keySet = useMemo(() => new Set(keyRatings), [keyRatings]);
  // Ratings named in ability requirements for this position (not already key ratings).
  const abilityRatings = useMemo(() => {
    const s = new Set<string>();
    for (const a of abilities) for (const t of a.tiers) if (t.pos.includes(pos)) for (const [type, k] of t.reqs) if (type === "rating" && !keySet.has(k)) s.add(k);
    return [...s];
  }, [abilities, pos, keySet]);

  const set = (i: number, v: number) => setRatings((r) => r.map((x, j) => (j === i ? clamp(v) : x)));
  const bump = (n: number) => setRatings((r) => r.map((x, i) => (keySet.has(RATING_KEYS[i]) ? clamp(x + n) : x)));
  const changed = ratings.some((r, i) => r !== p.ratings[i]) || pos !== p.pos || dev !== p.dev;
  const reset = () => { setRatings(p.ratings); setPos(p.pos); setDev(p.dev); };

  const sortedArch = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const newCount = result.eligible.filter((e) => tierRank(e.tier) > tierRank(beforeTier.get(e.ability.key))).length;

  const row = (k: string) => {
    const i = RATING_KEYS.indexOf(k as never);
    const v = ratings[i], d = v - p.ratings[i];
    const w = formulas[bestName]?.w[k] || 0;
    return (
      <div className="ac-rating" key={k}>
        <label htmlFor={`r-${k}`}>{labels[k] || k}</label>
        <div className="ac-stepper">
          <button type="button" onClick={() => set(i, v - 1)} aria-label={`Lower ${labels[k]}`}>−</button>
          <input id={`r-${k}`} type="number" inputMode="numeric" min={0} max={99} value={v}
            onChange={(e) => set(i, Number(e.target.value || 0))} />
          <button type="button" onClick={() => set(i, v + 1)} aria-label={`Raise ${labels[k]}`}>+</button>
        </div>
        <span className={`ac-delta ${d > 0 ? "up" : d < 0 ? "down" : ""}`}>{d ? signed(d) : ""}</span>
        <span className="ac-weight muted small" title={`Each point moves ${bestName} by about ${w.toFixed(2)}`}>{w >= 0.01 ? `${w.toFixed(2)}/pt` : ""}</span>
      </div>
    );
  };

  return (
    <>
      <div className="panel ac-head">
        <div>
          <div className="ac-name">{p.n}</div>
          <div className="muted small">{p.t} · {p.pos} · age {p.age} · {DEV[p.dev]} · in-game {p.ovr} OVR · <Link href={`/l/${slug}/players/${p.id}`}>player page</Link></div>
        </div>
        <div className="ac-controls">
          <label>Position
            <select value={pos} onChange={(e) => setPos(e.target.value)}>
              {(positions.length ? positions : [p.pos]).map((x) => <option key={x} value={x}>{x}{x === p.pos ? " (current)" : ""}</option>)}
            </select>
          </label>
          <label>Dev trait
            <select value={dev} onChange={(e) => setDev(Number(e.target.value))}>
              {DEV.map((x, i) => <option key={x} value={i}>{x}{i === p.dev ? " (current)" : ""}</option>)}
            </select>
          </label>
          <button type="button" className="btn btn-quiet" onClick={reset} disabled={!changed}>Reset</button>
        </div>
      </div>

      <div className="stat-tiles">
        <div className="tile">
          <div className="tile-label">Overall</div>
          <div className="tile-value">{ovr} <Delta n={ovr - p.ovr} /></div>
          <div className="tile-sub">{sameGroup && offset ? `calibrated ${signed(offset)} to match in-game` : "best archetype rating"}</div>
        </div>
        <div className="tile">
          <div className="tile-label">Best archetype</div>
          <div className="tile-value ac-arch-name">{bestName}</div>
          <div className="tile-sub">{pos} {group !== pos ? `(${group} formulas)` : ""}</div>
        </div>
        <div className="tile">
          <div className="tile-label">Ability slots open</div>
          <div className="tile-value">{slots.numbered.filter((s) => s.open).length} / {slots.numbered.length}{slots.xf ? " + XF" : ""}</div>
          <div className="tile-sub">{dev < 2 ? "Superstar or X-Factor dev only" : layout.estimated ? "slot layout estimated for this dev" : slots.numbered.filter((s) => !s.open).map((s) => `slot ${s.n} at ${s.unlock}`).join(", ") || "all unlocked"}</div>
        </div>
        <div className="tile">
          <div className="tile-label">Abilities eligible</div>
          <div className="tile-value">{result.eligible.length}</div>
          <div className="tile-sub">{newCount ? `${newCount} new or upgraded` : "no change"}{lost.length ? `, ${lost.length} lost` : ""}</div>
        </div>
      </div>

      <div className="panel">
        <h3 className="ac-h">Archetype ratings</h3>
        <ul className="ac-arches">
          {sortedArch.map(([name, s]) => {
            const before = sameGroup ? origScores[name] : undefined;
            const v = Math.round(s), d = before != null ? v - Math.round(before) : 0;
            return (
              <li key={name} className={name === bestName ? "best" : undefined}>
                <span className="ac-an">{name}{name === bestName && <span className="tag">overall</span>}</span>
                <span className="ac-bar"><span style={{ width: `${Math.max(0, Math.min(100, v))}%` }} /></span>
                <span className="ac-av">{v}</span>
                <span className="ac-delta-cell"><Delta n={d} /></span>
              </li>
            );
          })}
        </ul>
      </div>

      <FastestPath arch={arch} pos={pos} dev={dev} ratings={ratings} offset={sameGroup ? offset : 0} slots={layout.slots}
        abilities={abilities} labels={labels} ovr={ovr} scores={scores} onApply={setRatings} />

      <div className="ac-grid">
        <section className="panel">
          <div className="ac-sec-head">
            <h3 className="ac-h">Ratings that set his overall</h3>
            <div className="ac-bumps">
              <button type="button" className="btn btn-quiet ac-btn-sm" onClick={() => bump(-1)}>All −1</button>
              <button type="button" className="btn btn-quiet ac-btn-sm" onClick={() => bump(1)}>All +1</button>
            </div>
          </div>
          <p className="muted small">Sorted by weight in {bestName}. &quot;/pt&quot; is how much one point moves that archetype.</p>
          <div className="ac-ratings">{keyRatings.map(row)}</div>
          {abilityRatings.length > 0 && <>
            <h4 className="ac-sub">Used by ability requirements</h4>
            <div className="ac-ratings">{abilityRatings.map(row)}</div>
          </>}
          <button type="button" className="btn btn-quiet ac-btn-sm" onClick={() => setShowAll((x) => !x)}>{showAll ? "Hide other ratings" : "Show every rating"}</button>
          {showAll && RATING_GROUPS.map(([name, keys]) => {
            const rest = keys.filter((k) => !keySet.has(k) && !abilityRatings.includes(k));
            return rest.length ? <div key={name}><h4 className="ac-sub">{name}</h4><div className="ac-ratings">{rest.map(row)}</div></div> : null;
          })}
        </section>

        <section className="panel">
          <h3 className="ac-h">Abilities he qualifies for</h3>
          {dev < 2 ? <p className="muted">Only Superstar and X-Factor players get ability slots. Switch the dev trait to see what he&apos;d qualify for.</p> : <>
            {result.eligible.length === 0 && <p className="muted">Nothing yet.</p>}
            <ul className="ac-abils">
              {result.eligible.map((e) => <AbilityRow key={e.ability.key} slug={slug} e={e} before={beforeTier.get(e.ability.key)} held={held.get(e.ability.key)} />)}
            </ul>
            {lost.length > 0 && <>
              <h4 className="ac-sub">No longer eligible</h4>
              <ul className="ac-abils">
                {lost.map((e) => <li key={e.ability.key} className="ac-lost"><Link href={`/l/${slug}/abilities/${e.ability.key}`}>{e.ability.title}</Link> <Chip t={e.tier} kind={e.ability.kind} /></li>)}
              </ul>
            </>}
            {result.near.length > 0 && <details className="ac-near">
              <summary>Within reach ({result.near.length})</summary>
              <ul className="ac-abils">
                {result.near.map((n) => (
                  <li key={n.ability.key}>
                    <Link href={`/l/${slug}/abilities/${n.ability.key}`}>{n.ability.title}</Link> <Chip t={n.tier} kind={n.ability.kind} />
                    <div className="small muted">needs {n.missing.map(fmtMiss).join(", ")}</div>
                  </li>
                ))}
              </ul>
            </details>}
            <p className="muted small">Slots: {slots.numbered.map((s) => `${s.n} (${s.unlock}) ${s.open ? "open" : "locked"}`).join(" · ")}{slots.xf ? " · X-Factor slot" : ""}. Archetype calls within a point of a cutoff are marked &quot;close call&quot;.</p>
          </>}
        </section>
      </div>
    </>
  );
}

function FastestPath({ arch, pos, dev, ratings, offset, slots, abilities, labels, ovr, scores, onApply }: {
  arch: CalcArch; pos: string; dev: number; ratings: number[]; offset: number; slots: number[]; abilities: CalcAbility[];
  labels: Record<string, string>; ovr: number; scores: Record<string, number>; onApply: (r: number[]) => void;
}) {
  const [kind, setKind] = useState<PathTarget["kind"]>("ovr");
  const [ovrGoal, setOvrGoal] = useState(Math.min(99, ovr + 1));
  const archNames = useMemo(() => Object.keys(scores).sort(), [scores]);
  const [archName, setArchName] = useState(() => bestOf(scores)[0]);
  const [archGoal, setArchGoal] = useState(Math.min(99, Math.round(bestOf(scores)[1]) + 1));
  const options = useMemo(() => abilities.filter((a) => a.tiers.some((t) => t.pos.includes(pos)) && (a.kind !== "X-Factor" || dev === 3))
    .sort((a, b) => a.title.localeCompare(b.title)), [abilities, pos, dev]);
  const [abilKey, setAbilKey] = useState("");
  const ability = options.find((a) => a.key === abilKey) || options[0];
  const tiers = ability ? ability.tiers.filter((t) => t.pos.includes(pos)).map((t) => t.tier) : [];
  const [tier, setTier] = useState<CalcTierName>("Bronze");
  const tierPick = tiers.includes(tier) ? tier : tiers[0];
  const [store, setStore] = useState(false);

  const name = archNames.includes(archName) ? archName : archNames[0];
  const target: PathTarget | null = kind === "ovr" ? { kind, min: ovrGoal }
    : kind === "arch" ? { kind, name, min: archGoal }
    : ability && tierPick ? { kind, key: ability.key, tier: tierPick } : null;
  const res = useMemo(() => target && fastestPath(target, { arch, pos, dev, ratings, offset, slots, abilities, labels }, store ? { cap: 91, locked: STORE_LOCKED } : { cap: 99, locked: [] }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(target), arch, pos, dev, ratings, offset, slots, abilities, labels, store]);
  const after = res?.ok ? archetypeScores(arch, pos, res.ratings) : null;
  const afterOvr = after ? clamp(Math.round(bestOf(after)[1]) + offset) : null;
  const num = (v: number, set: (n: number) => void) => (
    <input type="number" inputMode="numeric" min={1} max={99} value={v} className="ac-path-num" onChange={(e) => set(clamp(Number(e.target.value || 0)))} />
  );

  return (
    <div className="panel ac-path">
      <h3 className="ac-h">Fastest path</h3>
      <p className="muted small">The fewest rating points to hit a goal, starting from the ratings below.</p>
      <div className="ac-path-form">
        <label>Goal
          <select value={kind} onChange={(e) => setKind(e.target.value as PathTarget["kind"])}>
            <option value="ovr">Overall</option>
            <option value="arch">Archetype rating</option>
            <option value="ability">Ability</option>
          </select>
        </label>
        {kind === "ovr" && <label>Overall {num(ovrGoal, setOvrGoal)}</label>}
        {kind === "arch" && <>
          <label>Archetype
            <select value={name} onChange={(e) => setArchName(e.target.value)}>{archNames.map((n) => <option key={n} value={n}>{n} ({Math.round(scores[n])})</option>)}</select>
          </label>
          <label>Rating {num(archGoal, setArchGoal)}</label>
        </>}
        {kind === "ability" && (options.length ? <>
          <label>Ability
            <select value={ability?.key} onChange={(e) => setAbilKey(e.target.value)}>{options.map((a) => <option key={a.key} value={a.key}>{a.title}</option>)}</select>
          </label>
          <label>Tier
            <select value={tierPick} onChange={(e) => setTier(e.target.value as CalcTierName)}>
              {tiers.map((t) => <option key={t} value={t}>{t === "Single" ? (ability?.kind === "X-Factor" ? "X-Factor" : "Superstar") : t}</option>)}
            </select>
          </label>
        </> : <span className="muted small">No abilities for {pos}s.</span>)}
        <label className="ac-path-check"><input type="checkbox" checked={store} onChange={(e) => setStore(e.target.checked)} /> Store rules (max 91, no THP, SPD, ACC, AGI, COD, STR, JMP)</label>
      </div>
      {res && (!res.ok ? <p className="ac-path-msg">Can&apos;t get there: {res.reason}.</p>
        : res.points === 0 ? <p className="ac-path-msg">Already there.</p>
        : <div className="ac-path-out">
          <div className="ac-path-sum">
            <strong>+{res.points} rating point{res.points === 1 ? "" : "s"}</strong>
            <span className="muted small">{afterOvr} OVR after ({signed(afterOvr! - ovr)}){res.via ? `, overall through ${res.via}` : ""}</span>
            <button type="button" className="btn ac-btn-sm" onClick={() => onApply(res.ratings)}>Apply to ratings</button>
          </div>
          <ul className="ac-path-steps">
            {res.steps.map((s) => <li key={s.key}><span>{labels[s.key] || s.key}</span><span className="muted">{s.from} → {s.to}</span><span className="ac-delta up">+{s.to - s.from}</span></li>)}
          </ul>
        </div>)}
    </div>
  );
}

const fmtMiss = (m: CalcShortfall) => (m.key === "slot" ? m.label : `${m.label} ${m.min}${m.have != null ? ` (has ${m.have})` : ""}`);

function Delta({ n }: { n: number }) {
  if (!n) return null;
  return <span className={`ac-delta ${n > 0 ? "up" : "down"}`}>{signed(n)}</span>;
}

function Chip({ t, kind }: { t: CalcTierName; kind: string }) {
  const label = t === "Single" ? (kind === "X-Factor" ? "X-Factor" : "Superstar") : t;
  return <span className={`tier tier-${label.toLowerCase()}`}>{label}</span>;
}

function AbilityRow({ slug, e, before, held }: { slug: string; e: CalcEligibility; before?: CalcTierName; held?: string }) {
  const up = tierRank(e.tier) > tierRank(before);
  return (
    <li>
      <Link href={`/l/${slug}/abilities/${e.ability.key}`}>{e.ability.title}</Link> <Chip t={e.tier} kind={e.ability.kind} />
      {up && <span className="tag ac-new">{before ? `up from ${before}` : "new"}</span>}
      {held && <span className="tag">has it ({held})</span>}
      {e.borderline && <span className="tag" title="Depends on an estimated archetype rating within a point of the cutoff">close call</span>}
      {e.next && <div className="small muted">{e.next.tier} needs {e.next.missing.map(fmtMiss).join(", ")}</div>}
    </li>
  );
}
