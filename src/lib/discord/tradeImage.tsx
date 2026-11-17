// The trade proposal picture posted in #trade-proposals (Nick, 2026-11-17): who gets what,
// each asset's speed/size and worth to the team getting it, each team's cap and starters
// before → after, and the trade score. Satori (next/og): flexbox and inline styles only.
import { ImageResponse } from "next/og";
import type { LeagueData, Team } from "../league/types";
import { heightText, money } from "../league/format";
import { GROUP_NAME, type AssetScore, type TeamScore, type TradePlayer, type TradeScore } from "../league/tradeMath";
import { cardFonts } from "./cardImage";
import { Badge, logoOf } from "./matchupImage";

const W = 1100;
const BG = "#070a14", PANEL = "#0d1324", LINE = "#222a44", INK = "#eceff8", SOFT = "#8a93b2", GOLD = "#ffd54a", GOOD = "#3ddc84", BAD = "#ff5d6c";
/** An arrow drawn as SVG: the bundled fonts have no → glyph, and Satori would try to fetch one from Google Fonts. */
const Arrow = () => (
  <svg width="22" height="14" viewBox="0 0 22 14" style={{ margin: "0 8px", alignSelf: "center" }}><path d="M0 7h18M12 1l7 6-7 6" stroke={SOFT} strokeWidth="2.5" fill="none" /></svg>
);
const GRADE_COLOR = (g: string) => (g.startsWith("A") ? GOOD : g.startsWith("B") ? "#9be15d" : g === "C" ? GOLD : BAD);

function Asset({ x, p }: { x: AssetScore; p?: TradePlayer }) {
  const phys = p ? [p.spd ? `${p.spd} SPD` : "", p.acc ? `${p.acc} ACC` : "", heightText(p.h), p.w ? `${p.w} lb` : ""].filter(Boolean).join(" · ") : x.sub;
  const meta = p ? `${p.pos} · ${p.ovr} OVR · age ${p.age}${p.dev ? ` · ${["", "Star", "Superstar", "X-Factor"][p.dev]}` : ""} · ${money(p.hits[0])}${p.yl ? `, ${p.yl} yr${p.yl === 1 ? "" : "s"}` : ""}` : "";
  return (
    <div style={{ display: "flex", alignItems: "center", padding: "10px 0", borderBottom: `1px solid ${LINE}` }}>
      {p ? (
        <div style={{ width: 62, height: 62, borderRadius: 12, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", backgroundColor: "#1a2240", border: `2px solid ${p.ur >= 90 ? GOLD : LINE}`, marginRight: 14 }}>
          <span style={{ fontSize: 30, fontWeight: 800, lineHeight: 1 }}>{p.ur}</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: SOFT }}>UR</span>
        </div>
      ) : (
        <div style={{ width: 62, height: 62, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "#1a2240", border: `2px solid ${LINE}`, marginRight: 14, fontSize: 18, fontWeight: 800, color: SOFT }}>PICK</div>
      )}
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 27, fontWeight: 800, lineHeight: 1.05, whiteSpace: "nowrap", overflow: "hidden" }}>{x.label}</span>
        {meta && <span style={{ fontSize: 17, fontWeight: 700, color: SOFT }}>{meta}</span>}
        <span style={{ fontSize: 17, fontWeight: 700, color: INK }}>{phys}</span>
        {x.note && <span style={{ fontSize: 16, fontWeight: 700, color: x.note.startsWith("Backup") || x.note.startsWith("Depth") ? SOFT : GOLD }}>{x.note}</span>}
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", width: 80 }}>
        <span style={{ fontSize: 32, fontWeight: 800, lineHeight: 1 }}>{x.worth.toFixed(0)}</span>
        <span style={{ fontSize: 14, fontWeight: 700, color: SOFT }}>{x.kind === "player" ? `fit ×${x.fit.toFixed(2)}` : "value"}</span>
      </div>
    </div>
  );
}

function Column({ t, team, logo, byId }: { t: TeamScore; team: Team; logo?: string; byId: Map<number, TradePlayer> }) {
  const cap = (label: string, before: number, after: number) => (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 19, fontWeight: 700, padding: "3px 0" }}>
      <span style={{ color: SOFT }}>{label}</span>
      <span style={{ display: "flex" }}>
        <span style={{ color: SOFT }}>{money(before)}</span>
        <Arrow />
        <span style={{ color: after < 0 ? BAD : INK }}>{money(after)}</span>
      </span>
    </div>
  );
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", backgroundColor: PANEL, borderRadius: 16, border: `1px solid ${LINE}`, borderTop: `6px solid ${team.primary}`, padding: "16px 20px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <Badge t={team} logo={logo} size={64} />
        <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
          <span style={{ fontSize: 17, fontWeight: 700, color: SOFT, textTransform: "uppercase", letterSpacing: 1 }}>{`${team.city} · ${team.user || "CPU"}`}</span>
          <span style={{ fontSize: 34, fontWeight: 800, lineHeight: 1, textTransform: "uppercase" }}>{`${team.name} get`}</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "4px 12px", borderRadius: 12, border: `3px solid ${GRADE_COLOR(t.grade)}` }}>
          <span style={{ fontSize: 40, fontWeight: 800, lineHeight: 1, color: GRADE_COLOR(t.grade) }}>{t.grade}</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: SOFT }}>GRADE</span>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", marginTop: 6 }}>
        {t.gets.length === 0 && <span style={{ fontSize: 22, color: SOFT, padding: "14px 0" }}>Nothing</span>}
        {t.gets.map((x) => <Asset key={x.id} x={x} p={x.kind === "player" ? byId.get(Number(x.id)) : undefined} />)}
      </div>
      <div style={{ display: "flex", flexDirection: "column", marginTop: 12 }}>
        <span style={{ fontSize: 16, fontWeight: 800, color: SOFT, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Team impact</span>
        {t.gives.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", fontSize: 19, fontWeight: 700, padding: "3px 0" }}>
            <span style={{ color: SOFT }}>Gives up</span>
            <span style={{ display: "flex" }}>{t.gives.map((x) => `${x.label} (${x.worth.toFixed(0)})`).join(", ")}</span>
          </div>
        )}
        {cap(`${t.capNow.y} cap space`, t.capNow.before, t.capNow.after)}
        {t.capNext && cap(`${t.capNext.y} (proj.)`, t.capNext.before, t.capNext.after)}
        {t.capNow.dead > 0 && (
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 19, fontWeight: 700, padding: "3px 0" }}>
            <span style={{ color: SOFT }}>New dead money</span><span>{money(t.capNow.dead)}</span>
          </div>
        )}
        {t.needs.map((n) => (
          <div key={n.g} style={{ display: "flex", justifyContent: "space-between", fontSize: 19, fontWeight: 700, padding: "3px 0" }}>
            <span style={{ color: SOFT }}>{`${GROUP_NAME[n.g] || n.g} starters (avg UR)`}</span>
            <span style={{ display: "flex" }}>
              <span style={{ color: SOFT }}>{n.before}</span>
              <Arrow />
              <span style={{ color: n.after > n.before ? GOOD : BAD }}>{n.after}</span>
            </span>
          </div>
        ))}
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 19, fontWeight: 800, padding: "6px 0 0", marginTop: 4, borderTop: `1px solid ${LINE}` }}>
          <span style={{ color: SOFT }}>{`Gets ${t.getsWorth.toFixed(0)} · gives ${t.givesWorth.toFixed(0)}${Math.abs(t.capPts) >= 0.5 ? ` · cap ${t.capPts >= 0 ? "+" : "−"}${Math.abs(t.capPts).toFixed(0)}` : ""}`}</span>
          <span style={{ color: t.net >= 0 ? GOOD : BAD }}>{`net ${t.net >= 0 ? "+" : ""}${t.net.toFixed(0)}`}</span>
        </div>
      </div>
    </div>
  );
}

export async function renderTrade(d: LeagueData, s: TradeScore, players: TradePlayer[], leagueName: string) {
  const ta = d.teams.find((t) => t.id === s.a.team.id)!, tb = d.teams.find((t) => t.id === s.b.team.id)!;
  const [la, lb] = await Promise.all([logoOf(ta), logoOf(tb)]);
  const byId = new Map(players.map((p) => [p.id, p]));
  const rows = Math.max(s.a.gets.length, s.b.gets.length, 1);
  const impact = Math.max(s.a.needs.length, s.b.needs.length) + 4;
  const over = [s.a, s.b].filter((t) => t.capNow.after < 0).map((t) => t.team.abbr);
  const height = 250 + rows * 118 + impact * 31 + (Math.max(s.a.gives.length, s.b.gives.length) > 2 ? 60 : 30) + (over.length ? 150 : 100);

  const node = (
    <div style={{ width: W, height, display: "flex", flexDirection: "column", backgroundColor: BG, color: INK, fontFamily: "Barlow Condensed", padding: "0 0 18px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px 28px", borderBottom: `2px solid ${LINE}`,
        backgroundImage: `linear-gradient(90deg, ${ta.primary}66, ${PANEL} 40%, ${PANEL} 60%, ${tb.primary}66)` }}>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ fontSize: 20, fontWeight: 700, color: SOFT, textTransform: "uppercase", letterSpacing: 1 }}>{`${leagueName} · ${d.season.year} ${d.season.title}`}</span>
          <span style={{ fontSize: 50, fontWeight: 800, lineHeight: 1, textTransform: "uppercase" }}>Trade proposal</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
          <span style={{ fontSize: 20, fontWeight: 700, color: SOFT, textTransform: "uppercase", letterSpacing: 1 }}>Trade score</span>
          <span style={{ fontSize: 40, fontWeight: 800, lineHeight: 1, color: s.favored ? GOLD : GOOD }}>{s.verdict}</span>
        </div>
      </div>

      <div style={{ display: "flex", margin: "16px 28px 0", height: 40, borderRadius: 20, overflow: "hidden", border: `1px solid ${LINE}` }}>
        <div style={{ width: `${s.score}%`, display: "flex", alignItems: "center", paddingLeft: 16, backgroundColor: ta.primary, fontSize: 24, fontWeight: 800 }}>{s.score >= 12 ? `${ta.abbr} ${s.score}` : ""}</div>
        <div style={{ width: 4, backgroundColor: BG }} />
        <div style={{ width: `${100 - s.score}%`, display: "flex", alignItems: "center", justifyContent: "flex-end", paddingRight: 16, backgroundColor: tb.primary, fontSize: 24, fontWeight: 800 }}>{100 - s.score >= 12 ? `${100 - s.score} ${tb.abbr}` : ""}</div>
      </div>

      <div style={{ display: "flex", gap: 18, padding: "16px 28px 0" }}>
        <Column t={s.a} team={ta} logo={la} byId={byId} />
        <Column t={s.b} team={tb} logo={lb} byId={byId} />
      </div>

      {over.length > 0 && (
        <div style={{ display: "flex", margin: "14px 28px 0", padding: "10px 16px", borderRadius: 10, backgroundColor: "#3a1420", color: BAD, fontSize: 21, fontWeight: 800 }}>
          {`${over.join(" and ")} would be over the ${s.a.capNow.y} cap: Madden won't accept this trade until that's fixed.`}
        </div>
      )}

      <div style={{ display: "flex", marginTop: "auto", padding: "12px 28px 0", fontSize: 17, fontWeight: 700, color: SOFT }}>
        {"UR = percentile at his position on speed, acceleration, size and position skills (physicals weigh far more than OVR). Fit = how much he upgrades the team's starters."}
      </div>
    </div>
  );
  return new ImageResponse(node, { width: W, height, fonts: await cardFonts() });
}
