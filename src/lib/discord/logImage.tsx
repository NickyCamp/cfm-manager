// /gamelog and /yearlog as pictures (Nick, 2026-11-24: "make this look nicer on the bot command"),
// in the /stats chart's style: a header with the player and season, then a stat table whose columns
// fit his position (passing for QBs, rushing + receiving for backs…). Satori (next/og).
import { ImageResponse } from "next/og";
import { indexes, passerRating, zeroTotals, addLine, REG_SEASON_LAST_WEEK, type Totals } from "../league/derive";
import type { LeagueData, Player, Team } from "../league/types";
import { DEV_LABEL } from "../league/types";
import { seasonKey, seasonLabel, seasonRow, type SeasonRow, type StatSeason } from "../league/playerSeasons";
import { cardFonts } from "./cardImage";
import { Badge, logoOf } from "./matchupImage";

const W = 1000;
const BG = "#070a14", PANEL = "#0d1324", LINE = "#222a44", INK = "#eceff8", SOFT = "#8a93b2";
const WIN = "#3ddc84", LOSS = "#ff6b6b", GOLD = "#ffd54a";

type L = Partial<Totals>;
type Col = { h: string; w: number; v: (t: L) => string };
type Group = { key: string; label: string; cols: Col[]; has: (t: Totals) => boolean };
const n = (x?: number) => x || 0;
const avg = (a: number, b: number) => (b ? (a / b).toFixed(1) : "–");

const GROUPS: Record<string, Group> = {
  pass: { key: "pass", label: "Passing", has: (t) => t.pa > 0, cols: [
    { h: "C/ATT", w: 84, v: (t) => (n(t.pa) ? `${n(t.pc)}/${n(t.pa)}` : "–") },
    { h: "YDS", w: 66, v: (t) => (n(t.pa) ? String(n(t.py)) : "–") },
    { h: "TD", w: 44, v: (t) => (n(t.pa) ? String(n(t.ptd)) : "–") },
    { h: "INT", w: 44, v: (t) => (n(t.pa) ? String(n(t.pint)) : "–") },
    { h: "RTG", w: 66, v: (t) => (n(t.pa) ? passerRating({ pa: n(t.pa), pc: n(t.pc), py: n(t.py), ptd: n(t.ptd), pint: n(t.pint) }).toFixed(1) : "–") },
  ] },
  rush: { key: "rush", label: "Rushing", has: (t) => t.ra > 0, cols: [
    { h: "CAR", w: 50, v: (t) => (n(t.ra) ? String(n(t.ra)) : "–") },
    { h: "YDS", w: 60, v: (t) => (n(t.ra) ? String(n(t.ry)) : "–") },
    { h: "AVG", w: 52, v: (t) => (n(t.ra) ? avg(n(t.ry), n(t.ra)) : "–") },
    { h: "TD", w: 40, v: (t) => (n(t.ra) ? String(n(t.rtd)) : "–") },
  ] },
  rec: { key: "rec", label: "Receiving", has: (t) => t.rc + t.rcy > 0, cols: [
    { h: "REC", w: 50, v: (t) => (n(t.rc) ? String(n(t.rc)) : "–") },
    { h: "YDS", w: 60, v: (t) => (n(t.rc) ? String(n(t.rcy)) : "–") },
    { h: "AVG", w: 52, v: (t) => (n(t.rc) ? avg(n(t.rcy), n(t.rc)) : "–") },
    { h: "TD", w: 40, v: (t) => (n(t.rc) ? String(n(t.rctd)) : "–") },
  ] },
  def: { key: "def", label: "Defense", has: (t) => t.tk + t.sk + t.int + t.pd > 0, cols: [
    { h: "TKL", w: 50, v: (t) => String(n(t.tk)) },
    { h: "SCK", w: 50, v: (t) => String(n(t.sk)) },
    { h: "INT", w: 44, v: (t) => String(n(t.int)) },
    { h: "PD", w: 44, v: (t) => String(n(t.pd)) },
    { h: "FF", w: 40, v: (t) => String(n(t.ff)) },
  ] },
  kick: { key: "kick", label: "Kicking", has: (t) => t.fga + t.xpa > 0, cols: [
    { h: "FG", w: 64, v: (t) => (n(t.fga) ? `${n(t.fgm)}/${n(t.fga)}` : "–") },
    { h: "LNG", w: 50, v: (t) => (n(t.fglng) ? String(n(t.fglng)) : "–") },
    { h: "XP", w: 64, v: (t) => (n(t.xpa) ? `${n(t.xpm)}/${n(t.xpa)}` : "–") },
  ] },
  punt: { key: "punt", label: "Punting", has: (t) => t.pnt > 0, cols: [
    { h: "PUNTS", w: 64, v: (t) => (n(t.pnt) ? String(n(t.pnt)) : "–") },
    { h: "AVG", w: 56, v: (t) => (n(t.pnt) ? avg(n(t.pnty), n(t.pnt)) : "–") },
    { h: "IN 20", w: 56, v: (t) => (n(t.pnt) ? String(n(t.pnt20)) : "–") },
  ] },
};

// Which stat groups lead for each position (the rest follow if he has numbers there and they fit).
const ORDER: Record<string, string[]> = {
  QB: ["pass", "rush"], HB: ["rush", "rec"], FB: ["rush", "rec"], WR: ["rec", "rush"], TE: ["rec", "rush"],
  K: ["kick"], P: ["punt"],
};
const DEF = ["LE", "RE", "DT", "LEDG", "REDG", "LOLB", "MLB", "ROLB", "SAM", "MIKE", "WILL", "CB", "FS", "SS"];

/** The stat groups to show, by his position first, then anything else he has numbers in (≤ ~560 px of columns). */
function pickGroups(pos: string, totals: Totals): Group[] {
  const first = ORDER[pos] ?? (DEF.includes(pos) ? ["def"] : []);
  const keys = [...first, ...Object.keys(GROUPS).filter((k) => !first.includes(k))];
  const out: Group[] = [];
  let width = 0;
  for (const k of keys) {
    const g = GROUPS[k];
    if (!g.has(totals) && !(first[0] === k && out.length === 0)) continue;
    const w = g.cols.reduce((s, c) => s + c.w, 0);
    if (out.length && width + w > 560) continue;
    out.push(g);
    width += w;
  }
  return out.length ? out : [GROUPS.def];
}

// nflverse team codes → nickname, to borrow the league's logo for real opponents.
const NFL_NICK: Record<string, string> = {
  ARI: "Cardinals", ATL: "Falcons", BAL: "Ravens", BUF: "Bills", CAR: "Panthers", CHI: "Bears", CIN: "Bengals", CLE: "Browns",
  DAL: "Cowboys", DEN: "Broncos", DET: "Lions", GB: "Packers", HOU: "Texans", IND: "Colts", JAX: "Jaguars", KC: "Chiefs",
  LA: "Rams", STL: "Rams", LAR: "Rams", LAC: "Chargers", SD: "Chargers", LV: "Raiders", OAK: "Raiders", MIA: "Dolphins",
  MIN: "Vikings", NE: "Patriots", NO: "Saints", NYG: "Giants", NYJ: "Jets", PHI: "Eagles", PIT: "Steelers", SEA: "Seahawks",
  SF: "49ers", TB: "Buccaneers", TEN: "Titans", WAS: "Commanders",
};
const nflTeam = (d: LeagueData, abbr: string) => d.teams.find((t) => t.name === NFL_NICK[abbr]);

async function logos(teams: (Team | undefined)[]) {
  const uniq = [...new Map(teams.filter((t): t is Team => Boolean(t)).map((t) => [t.id, t])).values()];
  return new Map(await Promise.all(uniq.map(async (t) => [t.id, await logoOf(t)] as const)));
}

function Head({ p, team, logo, kicker, title }: { p: Player; team?: Team; logo?: string; kicker: string; title: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 20, padding: "22px 32px", borderBottom: `2px solid ${LINE}`,
      backgroundImage: `linear-gradient(90deg, ${team?.primary ?? "#7a5cff"}77, ${PANEL} 60%)` }}>
      {team && <Badge t={team} logo={logo} size={84} />}
      <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
        <span style={{ fontSize: 22, fontWeight: 700, color: SOFT, textTransform: "uppercase", letterSpacing: 1 }}>{kicker}</span>
        <span style={{ fontSize: 52, fontWeight: 800, lineHeight: 1, textTransform: "uppercase" }}>{`${p.first} ${p.last}`}</span>
        <span style={{ fontSize: 22, fontWeight: 700, color: SOFT }}>{`${p.pos}${team ? ` · ${team.city} ${team.name}` : ""}${p.ovr ? ` · ${p.ovr} OVR ${DEV_LABEL[p.dev]}` : ""}`}</span>
      </div>
      <span style={{ fontSize: 40, fontWeight: 800, color: GOLD, textTransform: "uppercase", textAlign: "right", maxWidth: 260 }}>{title}</span>
    </div>
  );
}

function GroupHeads({ lead, groups }: { lead: { w: number; h: string }[]; groups: Group[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", padding: "10px 32px 0" }}>
      <div style={{ display: "flex", height: 22 }}>
        {lead.map((c, k) => <div key={k} style={{ width: c.w, display: "flex" }} />)}
        {groups.map((g) => (
          <div key={g.key} style={{ width: g.cols.reduce((s, c) => s + c.w, 0), display: "flex", justifyContent: "center", fontSize: 16, fontWeight: 800,
            color: GOLD, textTransform: "uppercase", letterSpacing: 1, borderBottom: `2px solid ${GOLD}55`, marginLeft: 6 }}>{g.label}</div>
        ))}
      </div>
      <div style={{ display: "flex", height: 34, alignItems: "center", borderBottom: `2px solid ${LINE}`, fontSize: 18, fontWeight: 800, color: SOFT }}>
        {lead.map((c, k) => <span key={k} style={{ width: c.w, display: "flex" }}>{c.h}</span>)}
        {groups.map((g) => (
          <div key={g.key} style={{ display: "flex", marginLeft: 6 }}>
            {g.cols.map((c) => <span key={c.h} style={{ width: c.w, display: "flex", justifyContent: "flex-end" }}>{c.h}</span>)}
          </div>
        ))}
      </div>
    </div>
  );
}

function Cells({ groups, t, strong }: { groups: Group[]; t: L; strong?: boolean }) {
  return (
    <>
      {groups.map((g) => (
        <div key={g.key} style={{ display: "flex", marginLeft: 6 }}>
          {g.cols.map((c) => (
            <span key={c.h} style={{ width: c.w, display: "flex", justifyContent: "flex-end", fontSize: 25, fontWeight: strong ? 800 : 700 }}>{c.v(t)}</span>
          ))}
        </div>
      ))}
    </>
  );
}

const done = async (node: React.ReactElement, height: number) =>
  new ImageResponse(node, { width: W, height, fonts: await cardFonts(), headers: { "cache-control": "public, max-age=600, s-maxage=600" } });

const shortWeek = (w: string) => w.replace(/^Preseason Week /, "PRE ").replace(/^Week /, "WK ").replace("Conference Championship", "CONF").replace("Conference", "CONF")
  .replace("Wild Card", "WC").replace("Wildcard", "WC").replace("Divisional", "DIV").replace("Super Bowl", "SB");

type GameRow = { week: string; post: boolean; pre: boolean; home: boolean; opp?: Team; oppText: string; us: number; them: number; final: boolean; simmed: boolean; line: L };

function gameRows(s: StatSeason, p: Player, d: LeagueData): GameRow[] {
  if (s.kind === "nfl") {
    return s.log.filter((e) => e.game.season === s.year).map(({ game: g, team, line }) => {
      const home = g.home === team;
      const oppAbbr = home ? g.away : g.home;
      const first = g.season >= 2021 ? 19 : 18;
      return {
        week: g.post ? ["WC", "DIV", "CONF", "SB"][g.week - first] ?? `WK ${g.week}` : `WK ${g.week}`, post: g.post, pre: false, home,
        opp: nflTeam(d, oppAbbr), oppText: oppAbbr, us: home ? g.hs : g.as, them: home ? g.as : g.hs, final: true, simmed: false, line: line as L,
      };
    });
  }
  const sd = s.d;
  const { games, teams } = indexes(sd);
  const title = (stage: number, week: number) => sd.weeks.find((w) => w.stage === stage && w.week === week)?.title ?? (stage === 0 ? `Preseason Week ${week + 1}` : `Week ${week + 1}`);
  return sd.lines.filter((l) => l.p === p.id).map((l) => ({ l, g: games.get(l.g)! })).filter((x) => x.g)
    .sort((a, b) => a.g.stage - b.g.stage || a.g.week - b.g.week)
    .map(({ l, g }) => {
      const home = g.home === l.t;
      const opp = teams.get(home ? g.away : g.home);
      return {
        week: shortWeek(title(g.stage, g.week)), post: g.stage === 1 && g.week > REG_SEASON_LAST_WEEK, pre: g.stage === 0, home, opp, oppText: opp?.abbr ?? "?",
        us: home ? g.hs : g.as, them: home ? g.as : g.hs, final: g.final, simmed: Boolean(g.simmed), line: l as L,
      };
    });
}

/** /gamelog: every game of one season. d is the current league data (teams for logos). */
export async function renderGameLog(d: LeagueData, p: Player, s: StatSeason, league: string) {
  const rows = gameRows(s, p, d);
  const reg = rows.filter((r) => !r.pre && !r.post);
  const totals = zeroTotals();
  for (const r of reg) addLine(totals, r.line as Record<string, number>);
  const all = zeroTotals();
  for (const r of rows) addLine(all, r.line as Record<string, number>);
  const groups = pickGroups(p.pos, all);
  const team = d.teams.find((t) => t.id === p.team);
  const logo = await logos([team, ...rows.map((r) => r.opp)]);
  const lead = [{ w: 86, h: "WEEK" }, { w: 150, h: "OPP" }, { w: 130, h: "RESULT" }];
  const R = 46;
  const height = 150 + 70 + rows.length * R + (reg.length ? 54 : 0) + 56;
  const node = (
    <div style={{ width: W, height, display: "flex", flexDirection: "column", backgroundColor: BG, color: INK, fontFamily: "Barlow Condensed" }}>
      <Head p={p} team={team} logo={team ? logo.get(team.id) : undefined} kicker={s.kind === "nfl" ? "Real NFL games" : `${league} game log`} title={seasonLabel(s, league)} />
      <GroupHeads lead={lead} groups={groups} />
      <div style={{ display: "flex", flexDirection: "column", padding: "0 32px" }}>
        {rows.map((r, k) => {
          const won = r.us > r.them, lost = r.us < r.them;
          return (
            <div key={k} style={{ display: "flex", alignItems: "center", height: R, borderBottom: `1px solid ${LINE}`,
              backgroundColor: r.post ? "rgba(255,213,74,.08)" : r.pre ? "rgba(255,255,255,.025)" : "transparent" }}>
              <span style={{ width: 86, display: "flex", fontSize: 20, fontWeight: 800, color: r.post ? GOLD : SOFT }}>{r.week}</span>
              <div style={{ width: 150, display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 18, fontWeight: 700, color: SOFT, width: 18 }}>{r.home ? "vs" : "@"}</span>
                {r.opp ? <Badge t={r.opp} logo={logo.get(r.opp.id)} size={32} /> : null}
                <span style={{ fontSize: 24, fontWeight: 800 }}>{r.oppText}</span>
              </div>
              <div style={{ width: 130, display: "flex", alignItems: "baseline", gap: 6 }}>
                {r.final ? <span style={{ fontSize: 24, fontWeight: 800, color: won ? WIN : lost ? LOSS : INK }}>{`${won ? "W" : lost ? "L" : "T"} ${r.us}-${r.them}`}</span> : null}
                {r.simmed ? <span style={{ fontSize: 15, fontWeight: 700, color: SOFT }}>SIM</span> : null}
              </div>
              <Cells groups={groups} t={r.line} />
            </div>
          );
        })}
        {reg.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", height: 54, borderTop: `2px solid ${GOLD}66`, backgroundColor: "rgba(255,213,74,.06)" }}>
            <span style={{ width: 366, display: "flex", fontSize: 22, fontWeight: 800, color: GOLD, textTransform: "uppercase" }}>{`Regular season · ${reg.length} GP`}</span>
            <Cells groups={groups} t={totals} strong />
          </div>
        )}
      </div>
      <div style={{ display: "flex", marginTop: "auto", padding: "12px 32px 18px", fontSize: 18, fontWeight: 700, color: SOFT }}>
        {s.kind === "nfl" ? `Real NFL games (nflverse) · ${s.year} season` : s.d.partialStats ? `${league} · ${s.year} · partial: only part of this season's stats were saved` : `${league} · ${s.year} season${rows.some((r) => r.simmed) ? " · SIM = simmed game" : ""}`}
      </div>
    </div>
  );
  return done(node, height);
}

/** /yearlog: regular-season totals for every season, league seasons first, then real NFL ones. */
export async function renderYearLog(d: LeagueData, p: Player, seasons: StatSeason[], league: string) {
  const rows = seasons.map((s) => seasonRow(s, p)).filter((r): r is SeasonRow => Boolean(r));
  const all = zeroTotals();
  for (const r of rows) for (const [k, v] of Object.entries(r.t)) (all as Record<string, number>)[k] += v as number;
  const groups = pickGroups(p.pos, all);
  const teamFor = (r: SeasonRow) => (r.s.kind === "nfl" ? nflTeam(d, r.team) : d.teams.find((t) => t.abbr === r.team));
  const team = d.teams.find((t) => t.id === p.team);
  const logo = await logos([team, ...rows.map(teamFor)]);
  const lead = [{ w: 140, h: "SEASON" }, { w: 120, h: "TEAM" }, { w: 50, h: "GP" }];
  const R = 50;
  const firstNfl = rows.findIndex((r) => r.s.kind === "nfl");
  const height = 150 + 70 + rows.length * R + (firstNfl > 0 ? 34 : 0) + 56;
  const node = (
    <div style={{ width: W, height, display: "flex", flexDirection: "column", backgroundColor: BG, color: INK, fontFamily: "Barlow Condensed" }}>
      <Head p={p} team={team} logo={team ? logo.get(team.id) : undefined} kicker="Stats by year · regular season" title="Career" />
      <GroupHeads lead={lead} groups={groups} />
      <div style={{ display: "flex", flexDirection: "column", padding: "0 32px" }}>
        {rows.length === 0 && <span style={{ display: "flex", padding: "24px 0", fontSize: 26, color: SOFT }}>No regular-season games yet.</span>}
        {rows.map((r, k) => {
          const t = teamFor(r);
          const nfl = r.s.kind === "nfl";
          return (
            <div key={seasonKey(r.s)} style={{ display: "flex", flexDirection: "column" }}>
              {k === firstNfl && k > 0 && (
                <div style={{ display: "flex", alignItems: "center", height: 34, fontSize: 17, fontWeight: 800, color: SOFT, textTransform: "uppercase", letterSpacing: 1 }}>Real NFL seasons</div>
              )}
              <div style={{ display: "flex", alignItems: "center", height: R, borderBottom: `1px solid ${LINE}`, backgroundColor: nfl ? "rgba(255,255,255,.025)" : "transparent" }}>
                <div style={{ width: 140, display: "flex", alignItems: "baseline", gap: 6 }}>
                  <span style={{ fontSize: 26, fontWeight: 800 }}>{String(r.s.year)}</span>
                  <span style={{ fontSize: 17, fontWeight: 800, color: nfl ? SOFT : GOLD }}>{nfl ? "NFL" : league}</span>
                  {r.note ? <span style={{ fontSize: 14, fontWeight: 700, color: SOFT }}>PARTIAL</span> : null}
                </div>
                <div style={{ width: 120, display: "flex", alignItems: "center", gap: 8 }}>
                  {t ? <Badge t={t} logo={logo.get(t.id)} size={32} /> : null}
                  <span style={{ fontSize: 22, fontWeight: 800 }}>{r.team}</span>
                </div>
                <span style={{ width: 50, display: "flex", fontSize: 25, fontWeight: 700 }}>{String(r.t.gp)}</span>
                <Cells groups={groups} t={r.t} />
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", marginTop: "auto", padding: "12px 32px 18px", fontSize: 18, fontWeight: 700, color: SOFT }}>
        {`${league} seasons, then real NFL seasons (nflverse) · /gamelog for any season's games`}
      </div>
    </div>
  );
  return done(node, height);
}
