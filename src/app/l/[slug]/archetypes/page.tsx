import type { Metadata } from "next";
import { getLeagueData } from "@/lib/league/load";
import { NoData } from "@/components/league/bits";
import abilityData from "@/lib/league/abilities-data.json";
import arch from "@/lib/league/archetypes.json";
import { RATING_LABEL } from "@/lib/league/ratings";
import type { CalcAbility, CalcArch } from "@/lib/league/archetypeCalc";
import { ArchetypeTool, type CalcListPlayer, type CalcPlayer } from "./ArchetypeTool";

export const metadata: Metadata = { title: "Archetype calculator" };
type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ player?: string }> };

const OFFENSE = ["QB", "HB", "FB", "WR", "TE", "LT", "LG", "C", "RG", "RT"];
const DEFENSE = ["LEDG", "REDG", "DT", "SAM", "MIKE", "WILL", "CB", "FS", "SS"];

export default async function ArchetypesPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { player } = await searchParams;
  const d = await getLeagueData(slug);
  if (!d) return <NoData />;

  const abbr = new Map(d.teams.map((t) => [t.id, t.abbr]));
  const live = d.players.filter((p) => !p.gone && p.ratings);
  const list: CalcListPlayer[] = live.map((p) => ({ id: p.id, n: `${p.first} ${p.last}`, pos: p.pos, t: abbr.get(p.team) || "FA", ovr: p.ovr }));

  const p = player ? live.find((x) => x.id === Number(player)) : undefined;
  const A = arch as unknown as CalcArch;
  let selected: CalcPlayer | null = null;
  let abilities: CalcAbility[] = [];
  let positions: string[] = [];
  if (p) {
    positions = (OFFENSE.includes(p.pos) ? OFFENSE : DEFENSE.includes(p.pos) ? DEFENSE : []).filter((x) => A.positions[x]);
    const posSet = new Set(positions.length ? positions : [p.pos]);
    // Only the abilities his side of the ball can get, trimmed to what the math needs.
    const all = (abilityData as unknown as { abilities: Record<string, { title: string; kind: string; tiers: CalcAbility["tiers"] }> }).abilities;
    abilities = Object.entries(all)
      .filter(([, a]) => a.tiers.some((t) => t.pos.some((x) => posSet.has(x))))
      .map(([key, a]) => ({ key, title: a.title, kind: a.kind, tiers: a.tiers.map((t) => ({ ...t, pos: t.pos.filter((x) => posSet.has(x)) })).filter((t) => t.pos.length) }));
    selected = {
      id: p.id, n: `${p.first} ${p.last}`, pos: p.pos, t: abbr.get(p.team) || "FA", age: p.age, ovr: p.ovr, dev: p.dev,
      ratings: p.ratings!, slots: (p.slots || []).map((s) => s.ovr),
      held: (p.slots || []).filter((s) => s.title).map((s) => ({ title: s.title, tier: s.tier })),
    };
  }

  return (
    <main className="page league-page">
      <div className="wrap">
        <h2>Archetype calculator</h2>
        <p className="muted" style={{ maxWidth: "70ch" }}>
          Pick a player, change any rating, and see his overall, every archetype rating and the abilities he qualifies for.
          Archetype ratings are estimated (EA doesn&apos;t export them); the formulas match in-game overall within a point for nearly every player.
        </p>
        <ArchetypeTool key={selected?.id ?? 0} slug={slug} list={list} player={selected} arch={A} abilities={abilities} positions={positions} labels={RATING_LABEL} />
      </div>
    </main>
  );
}
