// /amnesty as a picture (Nick, 2026-11-20: "chart it so it's a little cleaner to read"). His
// contract, a dead-money chart (normal cut vs the two amnesty options, by season) and the two
// contracts to enter in Madden. Satori (next/og), same look as /stats and /tws.
import { ImageResponse } from "next/og";
import type { LeagueData, Player, Team } from "../league/types";
import { DEV_LABEL } from "../league/types";
import { money } from "../league/format";
import { amnestyMoney as am, amnestyPlan, amnestyRecipe } from "../league/amnesty";
import { amnestyInput, buildAmnestyData, teamSpaceRows } from "../league/amnestyData";
import { cardFonts } from "./cardImage";
import { Badge, logoOf } from "./matchupImage";

const W = 1000;
const BG = "#070a14", PANEL = "#0d1324", LINE = "#222a44", INK = "#eceff8", SOFT = "#8a93b2";
const CUT = "#ff6b6b", OPT1 = "#ffd54a", OPT2 = "#4fd1c5", VOID = "#5b6488";

export async function renderAmnesty(d: LeagueData, p: Player, leagueName: string) {
  const ad = buildAmnestyData(d);
  const ap = ad.players.find((x) => x.id === p.id);
  const t: Team | undefined = d.teams.find((x) => x.id === p.team);
  const logo = t ? await logoOf(t) : undefined;
  const y0 = ad.year, c = p.contract;
  const plan = ap ? amnestyPlan(amnestyInput(ap), { space: ad.teams.find((x) => x.id === p.team)?.space, year: y0 }) : null;
  const r1 = plan ? amnestyRecipe(plan.target, 1, y0) : null, r2 = plan ? amnestyRecipe(plan.target, 2, y0) : null;

  // Cap hit by season (void-year bonus in grey).
  const seasons = ap ? ad.years.map((y, k) => ({ y, hit: ap.hits[k] || 0, dv: ap.dead[k] || 0 })).filter((s) => s.hit || s.dv) : [];
  const topHit = Math.max(1, ...seasons.map((s) => s.hit + s.dv));

  const tile = (label: string, value: string, sub?: string) => (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "12px 16px", backgroundColor: PANEL, border: `1px solid ${LINE}`, borderRadius: 12 }}>
      <span style={{ fontSize: 17, fontWeight: 700, color: SOFT, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</span>
      <span style={{ fontSize: 34, fontWeight: 800, lineHeight: 1.05 }}>{value}</span>
      {sub && <span style={{ fontSize: 17, fontWeight: 700, color: SOFT }}>{sub}</span>}
    </div>
  );
  const section = (title: string) => (
    <span style={{ display: "flex", fontSize: 20, fontWeight: 800, color: SOFT, textTransform: "uppercase", letterSpacing: 1, margin: "20px 0 8px" }}>{title}</span>
  );

  // Dead money chart: one row per way of moving on, a bar per season.
  const BAR = 210, COL = 350, LAB = 236;
  const deadRows = plan && r1 && r2 ? [
    { label: "Normal cut", sub: "Madden's penalty", color: CUT, v: [plan.normal[0], plan.normal[1]] },
    { label: "Option 1", sub: `1 year · 50% in ${y0}`, color: OPT1, v: [r1.split[0], 0] },
    { label: "Option 2", sub: "2 years · 25% + 25%", color: OPT2, v: [r2.split[0], r2.split[1]] },
  ] : [];
  const topDead = Math.max(1, ...deadRows.flatMap((r) => r.v));
  const deadBar = (v: number, color: string) => (
    <div style={{ width: COL, flexShrink: 0, display: "flex", alignItems: "center", gap: 10 }}>
      <div style={{ width: v > 0 ? Math.max(6, Math.round((v / topDead) * BAR)) : 2, height: 26, borderRadius: 6, backgroundColor: v > 0 ? color : LINE }} />
      <span style={{ fontSize: 26, fontWeight: 800, color: v > 0 ? INK : SOFT }}>{v > 0 ? am(v) : "$0"}</span>
    </div>
  );

  const optionCard = (r: NonNullable<typeof r1>, color: string, name: string) => (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", backgroundColor: PANEL, border: `2px solid ${color}`, borderRadius: 14, padding: "14px 18px" }}>
      <span style={{ fontSize: 26, fontWeight: 800, color, textTransform: "uppercase" }}>{name}</span>
      <span style={{ fontSize: 19, fontWeight: 700, color: SOFT, marginBottom: 8 }}>{r.years === 1 ? `All in ${y0}` : `Half in ${y0}, half in ${y0 + 1}`}</span>
      {[
        ["Contract length", r.years === 1 ? "1 year" : "2 years"],
        ["Years left", String(r.years)],
        ["Signing bonus", am(plan!.target)],
        ["Total salary", "$0"],
        ["Void / guaranteed yrs", "0 / 0"],
      ].map(([k, v]) => (
        <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: `1px solid ${LINE}` }}>
          <span style={{ fontSize: 22, fontWeight: 700, color: SOFT }}>{k}</span>
          <span style={{ fontSize: 24, fontWeight: 800 }}>{v}</span>
        </div>
      ))}
      <span style={{ fontSize: 17, fontWeight: 800, color: SOFT, textTransform: "uppercase", marginTop: 10 }}>Card should show</span>
      <span style={{ fontSize: 22, fontWeight: 800 }}>{`Cap hit ${am(r.split[0])} · Penalty ${am(plan!.target)}`}</span>
    </div>
  );

  // Team cap space this season and next, for each way of moving on.
  const at = ad.teams.find((x) => x.id === p.team);
  const spaceRows = plan && r1 && r2 && at ? teamSpaceRows(at, plan.keepCost, plan.normal, r1.split, r2.split) : [];
  const SPACE_COLOR: Record<string, string> = { keep: INK, cut: CUT, opt1: OPT1, opt2: OPT2 };
  const signed = (n: number) => (n > 0 ? "+" : n < 0 ? "−" : "±") + money(Math.abs(n));

  const warn = plan?.flags.find((f) => f.kind === "moreNow" || f.kind === "overCap");
  const rows = seasons.length;
  const height = 150 + 170 + (rows ? 56 + rows * 44 : 0) + (plan && plan.pen > 0 ? 56 + 36 + 3 * 64 + (warn ? 40 : 0) + (spaceRows.length ? 56 + 36 + spaceRows.length * 58 : 0) + 56 + 330 : 90) + 60;

  const node = (
    <div style={{ width: W, height, display: "flex", flexDirection: "column", backgroundColor: BG, color: INK, fontFamily: "Barlow Condensed" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 18, padding: "22px 32px", borderBottom: `2px solid ${LINE}`,
        backgroundImage: `linear-gradient(90deg, ${(t?.primary || "#7a5cff")}66, ${PANEL} 60%)` }}>
        {t && <Badge t={t} logo={logo} size={84} />}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ fontSize: 22, fontWeight: 700, color: SOFT, textTransform: "uppercase", letterSpacing: 1 }}>50% amnesty</span>
          <span style={{ fontSize: 52, fontWeight: 800, lineHeight: 1, textTransform: "uppercase" }}>{`${p.first} ${p.last}`}</span>
          <span style={{ fontSize: 22, fontWeight: 700, color: SOFT }}>{`${p.pos} · ${t ? `${t.city} ${t.name}` : "Free agent"} · ${p.ovr} OVR ${DEV_LABEL[p.dev]} · Age ${p.age}`}</span>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", padding: "0 32px" }}>
        {section("Current contract")}
        <div style={{ display: "flex", gap: 12 }}>
          {tile("Length", `${c.length} yrs`, `${c.yearsLeft} left`)}
          {tile("Total", money(c.salary + c.bonus), `${money(c.salary)} sal + ${money(c.bonus)} bonus`)}
          {tile(`Cap hit ${y0}`, money(c.capHit))}
          {tile("Dead if cut", money(c.releasePenalty), plan && plan.breakdown.voidBonus > 0 ? `incl. ${money(plan.breakdown.voidBonus)} void` : plan && plan.breakdown.other > 0 ? `incl. ${money(plan.breakdown.other)} gtd/old` : undefined)}
        </div>

        {rows > 0 && section("Cap hit by season")}
        {seasons.map((s, k) => (
          <div key={s.y} style={{ display: "flex", alignItems: "center", height: 44 }}>
            <span style={{ width: 90, fontSize: 24, fontWeight: 800 }}>{String(s.y)}</span>
            <div style={{ width: 560, display: "flex", alignItems: "center" }}>
              {s.hit > 0 && <div style={{ width: Math.max(6, Math.round((s.hit / topHit) * 560)), height: 22, borderRadius: 5, backgroundImage: `linear-gradient(90deg, ${t?.primary || "#3e8bff"}, ${t?.secondary || "#7a5cff"})` }} />}
              {s.dv > 0 && <div style={{ width: Math.max(6, Math.round((s.dv / topHit) * 560)), height: 22, borderRadius: 5, backgroundColor: VOID, marginLeft: s.hit ? 3 : 0 }} />}
            </div>
            <span style={{ fontSize: 24, fontWeight: 800, marginLeft: 16 }}>{s.hit ? money(s.hit) : ""}</span>
            <span style={{ fontSize: 19, fontWeight: 700, color: SOFT, marginLeft: 8 }}>{`${s.dv ? `${s.hit ? "+ " : ""}${money(s.dv)} void` : ""}${k && s.hit ? " proj." : ""}`}</span>
          </div>
        ))}

        {plan && plan.pen > 0 && r1 && r2 ? (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {section(`Dead money: half of ${money(plan.pen)} = ${am(plan.target)}`)}
            <div style={{ display: "flex", padding: "0 0 4px" }}>
              <span style={{ width: LAB, flexShrink: 0 }} />
              <span style={{ width: COL, flexShrink: 0, fontSize: 20, fontWeight: 800, color: SOFT }}>{String(y0)}</span>
              <span style={{ width: COL, flexShrink: 0, fontSize: 20, fontWeight: 800, color: SOFT }}>{String(y0 + 1)}</span>
            </div>
            {deadRows.map((r) => (
              <div key={r.label} style={{ display: "flex", alignItems: "center", height: 64, borderTop: `1px solid ${LINE}` }}>
                <div style={{ width: LAB, flexShrink: 0, display: "flex", flexDirection: "column" }}>
                  <span style={{ fontSize: 26, fontWeight: 800, color: r.color }}>{r.label}</span>
                  <span style={{ fontSize: 17, fontWeight: 700, color: SOFT }}>{r.sub}</span>
                </div>
                {deadBar(r.v[0], r.color)}
                {deadBar(r.v[1], r.color)}
              </div>
            ))}
            {warn && <span style={{ display: "flex", fontSize: 19, fontWeight: 700, color: "#ffb454", marginTop: 8 }}>{`${warn.kind === "moreNow" ? `Option 1 costs ${am(plan.target - plan.normal[0])} more in ${y0} than a normal cut, but ${y0 + 1} is clear.` : warn.text}`}</span>}
            {spaceRows.length > 0 && at && (
              <div style={{ display: "flex", flexDirection: "column" }}>
                {section(`${t ? t.name : "Team"} cap space`)}
                <div style={{ display: "flex", padding: "0 0 4px" }}>
                  <span style={{ width: LAB, flexShrink: 0 }} />
                  {[0, 1].map((i) => <span key={i} style={{ width: COL, flexShrink: 0, fontSize: 20, fontWeight: 800, color: SOFT }}>{`${y0 + i}${at.capSet[i] ? "" : " (proj.)"}`}</span>)}
                </div>
                {spaceRows.map((r) => (
                  <div key={r.key} style={{ display: "flex", alignItems: "center", height: 58, borderTop: `1px solid ${LINE}` }}>
                    <span style={{ width: LAB, flexShrink: 0, fontSize: 24, fontWeight: 800, color: SPACE_COLOR[r.key] }}>{r.label}</span>
                    {[0, 1].map((i) => (
                      <div key={i} style={{ width: COL, flexShrink: 0, display: "flex", alignItems: "baseline", gap: 10 }}>
                        <span style={{ fontSize: 30, fontWeight: 800, color: r.v[i] < 0 ? "#ff5c6c" : INK }}>{(r.v[i] < 0 ? "−" : "") + money(Math.abs(r.v[i]))}</span>
                        {r.key !== "keep" && <span style={{ fontSize: 19, fontWeight: 700, color: SOFT }}>{signed(r.v[i] - spaceRows[0].v[i])}</span>}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
            {section("Set in Madden: Edit Player › Contract, then cut")}
            <div style={{ display: "flex", gap: 16 }}>
              {optionCard(r1, OPT1, "Option 1 · 1 year")}
              {optionCard(r2, OPT2, "Option 2 · 2 years")}
            </div>
          </div>
        ) : (
          <span style={{ display: "flex", fontSize: 26, fontWeight: 700, color: SOFT, marginTop: 24 }}>{plan?.flags[0]?.text || "Free agent: nothing to amnesty."}</span>
        )}
      </div>
      <div style={{ display: "flex", marginTop: "auto", padding: "12px 32px 18px", fontSize: 18, fontWeight: 700, color: SOFT }}>
        {`${leagueName} · ${d.season.year} ${d.season.title} · check the card's penalty reads ${plan ? am(plan.target) : "$0"} before cutting`}
      </div>
    </div>
  );
  return new ImageResponse(node, { width: W, height, fonts: await cardFonts(), headers: { "cache-control": "public, max-age=600, s-maxage=600" } });
}
