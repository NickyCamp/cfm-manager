import Link from "next/link";
import { ABILITIES, clutchTraitUrl, maddenSchoolUrl, mechanic, type Ability, type Eligibility } from "@/lib/league/abilities";

export function TierPill({ tier }: { tier: string }) {
  const label = tier === "Single" ? "X-Factor" : tier;
  return <span className={`tier tier-${label.toLowerCase()}`}>{label}</span>;
}

function MechList({ title, ids }: { title: string; ids?: string[] }) {
  if (!ids?.length) return null;
  return (
    <div className="ab-mech">
      <div className="ab-mech__h">{title}</div>
      <ul>{ids.map((id) => { const m = mechanic(id); return <li key={id}>{m.group && <span className="muted">{m.group}: </span>}{m.text}</li>; })}</ul>
    </div>
  );
}

function AbilityLinks({ slug, keys, label }: { slug: string; keys: string[]; label: string }) {
  const list = keys.map((k) => ABILITIES[k]).filter(Boolean);
  if (!list.length) return null;
  return (
    <p className="small"><span className="muted">{label}:</span>{" "}
      {list.map((a, i) => <span key={a.key}>{i > 0 && ", "}<Link href={`/l/${slug}/abilities/${a.key}`}>{a.title}</Link></span>)}
    </p>
  );
}

/** What an ability does: Madden's triggers, effects and shutdowns, plus related abilities. */
export function AbilityMechanics({ a, slug }: { a: Ability; slug: string }) {
  const ct = clutchTraitUrl(a), ms = maddenSchoolUrl(a);
  return (
    <div className="ab-body">
      <div className="ab-mechs">
        <MechList title="Turns on" ids={a.triggers} />
        <MechList title="Changes" ids={a.effects} />
        <MechList title="Shut off by" ids={a.stops} />
      </div>
      <AbilityLinks slug={slug} keys={a.matchups} label="Goes head to head with" />
      <AbilityLinks slug={slug} keys={a.overlaps} label="Shares effects with" />
      <p className="small">
        {ct && <a href={ct} target="_blank" rel="noopener noreferrer">Full breakdown on ClutchTrait ↗</a>}
        {ct && ms && " · "}
        {ms && <a href={ms} target="_blank" rel="noopener noreferrer">Requirements on Madden School ↗</a>}
      </p>
    </div>
  );
}

/** One eligible ability: tier he qualifies for, what the next tier still needs, and its mechanics. */
export function EligibleRow({ e, slug }: { e: Eligibility; slug: string }) {
  return (
    <details className="ab-row">
      <summary>
        <TierPill tier={e.tier} />
        <Link href={`/l/${slug}/abilities/${e.ability.key}`} className="ab-name">{e.ability.title}</Link>
        {e.borderline && <span className="tag" title="Depends on an estimated archetype rating within a point of the cutoff">close call</span>}
        {e.next && (
          <span className="ab-next small muted">
            {e.next.tier} needs {e.next.missing.map((m) => `${m.label} ${m.min ? `${m.min}` : ""}${m.have != null ? ` (has ${m.have})` : ""}`.trim()).join(", ")}
          </span>
        )}
      </summary>
      <AbilityMechanics a={e.ability} slug={slug} />
    </details>
  );
}
