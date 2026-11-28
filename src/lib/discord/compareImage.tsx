// /compare as a picture (Nick, 2026-11-28), laid out like Stathead's head-to-head page: both players up top
// (art, name, team), then sections of rows with the first player's number, the stat, the second player's
// number, and the better side tinted green. Same dark style as /stats and /gamelog. Satori (next/og).
import { ImageResponse } from "next/og";
import type { LeagueData, Player, Team } from "../league/types";
import { DEV_LABEL } from "../league/types";
import { cardFonts } from "./cardImage";
import { cardArtFor } from "./cardArtLoad";
import { Badge, logoOf } from "./matchupImage";
import type { CmpRow, Comparison } from "./compare";

const W = 1000, PAD = 32, CELL = 330, MID = W - PAD * 2 - CELL * 2;
const BG = "#070a14", PANEL = "#0d1324", LINE = "#222a44", INK = "#eceff8", SOFT = "#8a93b2", GOLD = "#ffd54a";
const WIN_BG = "rgba(61,220,132,.17)", WIN_INK = "#7dffb0";
const R = 44, SEC = 46, HEAD = 300;

/** Rough line count for a wrapped text cell (abilities), ~34 characters a line at 20 px in 330 px. */
const textLines = (s: string) => Math.max(1, Math.ceil(s.length / 34));
const rowH = (r: CmpRow) => (r.text ? Math.max(textLines(r.a), textLines(r.b)) * 26 + 18 : R);

type Side = { p: Player; team?: Team; logo?: string; art?: string; cutout: boolean };

function Photo({ s }: { s: Side }) {
  const c = s.team?.primary ?? "#3a3f5c";
  return (
    <div style={{ width: 170, height: 190, display: "flex", alignItems: "flex-end", justifyContent: "center", overflow: "hidden", borderRadius: 14,
      border: `3px solid ${s.team?.secondary ?? LINE}`, backgroundImage: `linear-gradient(180deg, ${c}, ${PANEL})` }}>
      {s.art
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={s.art} alt="" width={170} height={190} style={{ width: 170, height: 190, objectFit: s.cutout ? "contain" : "cover", objectPosition: s.cutout ? "bottom" : "top" }} />
        : <span style={{ fontSize: 96, fontWeight: 800, color: "rgba(255,255,255,.35)", alignSelf: "center" }}>{String(s.p.jersey || "?")}</span>}
    </div>
  );
}

function PlayerHead({ s, right }: { s: Side; right?: boolean }) {
  const t = s.team;
  return (
    <div style={{ width: CELL + 40, display: "flex", flexDirection: right ? "row-reverse" : "row", alignItems: "center", gap: 16 }}>
      <Photo s={s} />
      <div style={{ display: "flex", flexDirection: "column", alignItems: right ? "flex-end" : "flex-start", flex: 1 }}>
        {t ? <Badge t={t} logo={s.logo} size={46} /> : null}
        <span style={{ fontSize: 24, fontWeight: 700, color: SOFT, textTransform: "uppercase", marginTop: 6 }}>{s.p.first}</span>
        <span style={{ fontSize: 40, fontWeight: 800, lineHeight: 1, textTransform: "uppercase", textAlign: right ? "right" : "left" }}>{s.p.last}</span>
        <span style={{ fontSize: 19, fontWeight: 700, color: SOFT, marginTop: 6, textAlign: right ? "right" : "left" }}>
          {`${s.p.pos} · ${t ? t.abbr : "FA"} · ${s.p.ovr} ${DEV_LABEL[s.p.dev]}`}
        </span>
      </div>
    </div>
  );
}

function Cell({ v, win, text, right }: { v: string; win: boolean; text?: boolean; right?: boolean }) {
  return (
    <div style={{ width: CELL, display: "flex", alignItems: "center", justifyContent: text ? (right ? "flex-end" : "flex-start") : "center",
      padding: text ? "8px 14px" : 0, backgroundColor: win ? WIN_BG : "transparent" }}>
      <span style={{ fontSize: text ? 20 : 27, fontWeight: win ? 800 : 700, color: win ? WIN_INK : text ? SOFT : INK, textAlign: text ? (right ? "right" : "left") : "center", lineHeight: text ? 1.3 : 1 }}>{v}</span>
    </div>
  );
}

export async function renderCompare(slug: string, d: LeagueData, a: Player, b: Player, c: Comparison) {
  const sides: Side[] = await Promise.all([a, b].map(async (p) => {
    const team = d.teams.find((t) => t.id === p.team);
    const [logo, art] = await Promise.all([team ? logoOf(team) : undefined, cardArtFor(slug, p).catch(() => ({ art: undefined, cutout: false }))]);
    return { p, team, logo, art: art.art, cutout: art.cutout };
  }));
  const body = c.sections.reduce((h, s) => h + SEC + s.rows.reduce((x, r) => x + rowH(r), 0), 0);
  const height = HEAD + body + 70;
  const node = (
    <div style={{ width: W, height, display: "flex", flexDirection: "column", backgroundColor: BG, color: INK, fontFamily: "Barlow Condensed" }}>
      <div style={{ height: HEAD, display: "flex", alignItems: "center", justifyContent: "space-between", padding: `0 ${PAD}px`, borderBottom: `2px solid ${LINE}`,
        backgroundImage: `linear-gradient(90deg, ${sides[0].team?.primary ?? "#7a5cff"}66, ${PANEL} 40%, ${PANEL} 60%, ${sides[1].team?.primary ?? "#7a5cff"}66)` }}>
        <PlayerHead s={sides[0]} />
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 180 }}>
          <span style={{ fontSize: 54, fontWeight: 800, color: GOLD }}>VS</span>
          <span style={{ fontSize: 20, fontWeight: 800, color: SOFT, textTransform: "uppercase", textAlign: "center", letterSpacing: 1 }}>{c.title}</span>
        </div>
        <PlayerHead s={sides[1]} right />
      </div>
      <div style={{ display: "flex", flexDirection: "column", padding: `0 ${PAD}px` }}>
        {c.sections.map((s) => (
          <div key={s.title} style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ height: SEC, display: "flex", alignItems: "center", justifyContent: "center", marginTop: 0, borderBottom: `2px solid ${GOLD}55`,
              fontSize: 23, fontWeight: 800, color: GOLD, textTransform: "uppercase", letterSpacing: 1 }}>{s.title}</div>
            {s.rows.map((r, k) => (
              <div key={k} style={{ height: rowH(r), display: "flex", alignItems: "stretch", borderBottom: `1px solid ${LINE}` }}>
                <Cell v={r.a} win={r.win === 0} text={r.text} />
                <div style={{ width: MID, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 23, fontWeight: 800, color: SOFT,
                  borderLeft: `1px solid ${LINE}`, borderRight: `1px solid ${LINE}`, textTransform: "uppercase" }}>{r.label}</div>
                <Cell v={r.b} win={r.win === 1} text={r.text} right />
              </div>
            ))}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", marginTop: "auto", padding: `12px ${PAD}px 18px`, fontSize: 18, fontWeight: 700, color: SOFT }}>
        {`${c.notes.join(" · ")} · green = better`}
      </div>
    </div>
  );
  return new ImageResponse(node, { width: W, height, fonts: await cardFonts(), headers: { "cache-control": "public, max-age=600, s-maxage=3600" } });
}
