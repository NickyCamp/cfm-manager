"use client";
// Players tab, "Season stats" view: regular-season stat leaders by position.
// QB is the default; each position gets its own column set and default sort.
// Rate columns (Cmp%, Y/A, Rtg, averages) only rank players with real volume,
// so a 1-for-1 backup doesn't top the list.
import Link from "next/link";
import { Fragment, useEffect, useMemo, useState } from "react";
import type { Totals } from "@/lib/league/derive";
import type { TeamLite } from "./PlayersTable";

export type StatRow = { id: number; n: string; pos: string; age: number; ovr: number; t: number; gone: boolean; s: Totals };

type Col = {
  key: string; label: string; title?: string;
  get: (s: Totals) => number;
  fmt?: (v: number) => string;
  /** Rate stat: players under the volume bar sort below everyone who clears it. */
  rate?: boolean;
};
type PosTab = { key: string; label: string; positions: string[]; has: (s: Totals) => boolean; volume: (s: Totals) => number; volumeLabel: string; cols: Col[]; sort: string };

const f1 = (v: number) => v.toFixed(1);
const pctF = (v: number) => v.toFixed(1);
const div = (a: number, b: number) => (b ? a / b : 0);
const rating = (s: Totals) => {
  if (!s.pa) return 0;
  const c = (x: number) => Math.max(0, Math.min(2.375, x));
  return ((c((s.pc / s.pa - 0.3) * 5) + c((s.py / s.pa - 3) * 0.25) + c((s.ptd / s.pa) * 20) + c(2.375 - (s.pint / s.pa) * 25)) / 6) * 100;
};

const GP: Col = { key: "gp", label: "GP", title: "Games played", get: (s) => s.gp };
const PASS: Col[] = [
  { key: "pc", label: "Cmp", title: "Completions", get: (s) => s.pc },
  { key: "pa", label: "Att", title: "Pass attempts", get: (s) => s.pa },
  { key: "cpct", label: "Cmp%", title: "Completion percentage", get: (s) => div(s.pc, s.pa) * 100, fmt: pctF, rate: true },
  { key: "py", label: "Yds", title: "Passing yards", get: (s) => s.py },
  { key: "ypa", label: "Y/A", title: "Yards per attempt", get: (s) => div(s.py, s.pa), fmt: f1, rate: true },
  { key: "pypg", label: "Y/G", title: "Passing yards per game", get: (s) => div(s.py, s.gp), fmt: f1 },
  { key: "ptd", label: "TD", title: "Passing touchdowns", get: (s) => s.ptd },
  { key: "pint", label: "INT", title: "Interceptions thrown", get: (s) => s.pint },
  { key: "plng", label: "Lng", title: "Longest pass", get: (s) => s.plng },
  { key: "psk", label: "Sck", title: "Times sacked", get: (s) => s.psk },
  { key: "rtg", label: "Rtg", title: "Passer rating", get: rating, fmt: f1, rate: true },
];
const RUSH: Col[] = [
  { key: "ra", label: "Car", title: "Rushing attempts", get: (s) => s.ra },
  { key: "ry", label: "Rush yds", title: "Rushing yards", get: (s) => s.ry },
  { key: "ypc", label: "Avg", title: "Yards per carry", get: (s) => div(s.ry, s.ra), fmt: f1, rate: true },
  { key: "rtd", label: "Rush TD", title: "Rushing touchdowns", get: (s) => s.rtd },
  { key: "rlng", label: "Lng", title: "Longest run", get: (s) => s.rlng },
  { key: "rbt", label: "BTK", title: "Broken tackles", get: (s) => s.rbt },
  { key: "rfum", label: "Fum", title: "Fumbles", get: (s) => s.rfum },
];
const REC: Col[] = [
  { key: "rc", label: "Rec", title: "Receptions", get: (s) => s.rc },
  { key: "rcy", label: "Rec yds", title: "Receiving yards", get: (s) => s.rcy },
  { key: "ypr", label: "Avg", title: "Yards per catch", get: (s) => div(s.rcy, s.rc), fmt: f1, rate: true },
  { key: "rcypg", label: "Y/G", title: "Receiving yards per game", get: (s) => div(s.rcy, s.gp), fmt: f1 },
  { key: "rctd", label: "Rec TD", title: "Receiving touchdowns", get: (s) => s.rctd },
  { key: "rclng", label: "Lng", title: "Longest catch", get: (s) => s.rclng },
  { key: "rcyac", label: "YAC", title: "Yards after catch", get: (s) => s.rcyac },
  { key: "rcdrop", label: "Drops", title: "Drops", get: (s) => s.rcdrop },
];
const DEF: Col[] = [
  { key: "tk", label: "Tkl", title: "Tackles", get: (s) => s.tk },
  { key: "sk", label: "Sck", title: "Sacks", get: (s) => s.sk, fmt: (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1)) },
  { key: "int", label: "INT", title: "Interceptions", get: (s) => s.int },
  { key: "pd", label: "PD", title: "Passes defended", get: (s) => s.pd },
  { key: "ff", label: "FF", title: "Forced fumbles", get: (s) => s.ff },
  { key: "fr", label: "FR", title: "Fumble recoveries", get: (s) => s.fr },
  { key: "dtd", label: "TD", title: "Defensive touchdowns", get: (s) => s.dtd },
  { key: "sfty", label: "Sfty", title: "Safeties", get: (s) => s.sfty },
];
const scrim: Col = { key: "scrim", label: "Scrim yds", title: "Rushing + receiving yards", get: (s) => s.ry + s.rcy };
const touches: Col = { key: "tot_td", label: "Tot TD", title: "Rushing + receiving touchdowns", get: (s) => s.rtd + s.rctd };

const anyDef = (s: Totals) => s.tk + s.sk + s.int + s.pd + s.ff + s.fr > 0;
const TABS: PosTab[] = [
  { key: "QB", label: "QB", positions: ["QB"], has: (s) => s.pa > 0, volume: (s) => s.pa, volumeLabel: "pass attempts", sort: "py",
    cols: [GP, ...PASS, ...RUSH.filter((c) => ["ra", "ry", "rtd"].includes(c.key))] },
  { key: "RB", label: "RB", positions: ["HB", "FB"], has: (s) => s.ra + s.rc > 0, volume: (s) => s.ra, volumeLabel: "carries", sort: "ry",
    cols: [GP, ...RUSH, ...REC.filter((c) => ["rc", "rcy", "rctd"].includes(c.key)), scrim, touches] },
  { key: "WR", label: "WR", positions: ["WR"], has: (s) => s.rc + s.ra > 0, volume: (s) => s.rc, volumeLabel: "catches", sort: "rcy",
    cols: [GP, ...REC, ...RUSH.filter((c) => ["ra", "ry"].includes(c.key)), scrim] },
  { key: "TE", label: "TE", positions: ["TE"], has: (s) => s.rc + s.ra > 0, volume: (s) => s.rc, volumeLabel: "catches", sort: "rcy",
    cols: [GP, ...REC, scrim] },
  { key: "DL", label: "DL", positions: ["LEDG", "REDG", "LE", "RE", "DT"], has: anyDef, volume: (s) => s.gp, volumeLabel: "games", sort: "sk", cols: [GP, ...DEF] },
  { key: "LB", label: "LB", positions: ["SAM", "MIKE", "WILL", "LOLB", "MLB", "ROLB"], has: anyDef, volume: (s) => s.gp, volumeLabel: "games", sort: "tk", cols: [GP, ...DEF] },
  { key: "DB", label: "DB", positions: ["CB", "FS", "SS"], has: anyDef, volume: (s) => s.gp, volumeLabel: "games", sort: "int", cols: [GP, ...DEF] },
  { key: "K", label: "K", positions: ["K"], has: (s) => s.fga + s.xpa > 0, volume: (s) => s.fga, volumeLabel: "field goal tries", sort: "fgm",
    cols: [GP,
      { key: "fgm", label: "FGM", title: "Field goals made", get: (s) => s.fgm },
      { key: "fga", label: "FGA", title: "Field goals attempted", get: (s) => s.fga },
      { key: "fgpct", label: "FG%", title: "Field goal percentage", get: (s) => div(s.fgm, s.fga) * 100, fmt: pctF, rate: true },
      { key: "fglng", label: "Lng", title: "Longest field goal", get: (s) => s.fglng },
      { key: "xpm", label: "XPM", title: "Extra points made", get: (s) => s.xpm },
      { key: "xpa", label: "XPA", title: "Extra points attempted", get: (s) => s.xpa },
      { key: "xppct", label: "XP%", title: "Extra point percentage", get: (s) => div(s.xpm, s.xpa) * 100, fmt: pctF, rate: true },
      { key: "kpts", label: "Pts", title: "Points (3 per FG + 1 per XP)", get: (s) => s.fgm * 3 + s.xpm }] },
  { key: "P", label: "P", positions: ["P"], has: (s) => s.pnt > 0, volume: (s) => s.pnt, volumeLabel: "punts", sort: "pavg",
    cols: [GP,
      { key: "pnt", label: "Punts", get: (s) => s.pnt },
      { key: "pnty", label: "Yds", title: "Punt yards", get: (s) => s.pnty },
      { key: "pavg", label: "Avg", title: "Yards per punt", get: (s) => div(s.pnty, s.pnt), fmt: f1, rate: true },
      { key: "pnet", label: "Net", title: "Net yards per punt", get: (s) => div(s.pntnet, s.pnt), fmt: f1, rate: true },
      { key: "pnt20", label: "In 20", title: "Punts inside the 20", get: (s) => s.pnt20 },
      { key: "pntlng", label: "Lng", title: "Longest punt", get: (s) => s.pntlng }] },
];
// Share of the position's busiest player a guy needs before rate stats rank him.
const QUALIFY = 0.35;

export function StatsTable({ slug, teams, rows, initial }: { slug: string; teams: TeamLite[]; rows: StatRow[]; initial: Record<string, string> }) {
  const [tabKey, setTabKey] = useState(TABS.some((t) => t.key === initial.pos) ? initial.pos : "QB");
  const tab = TABS.find((t) => t.key === tabKey)!;
  const [sort, setSort] = useState(initial.sort && tab.cols.some((c) => c.key === initial.sort) ? initial.sort : tab.sort);
  const [dir, setDir] = useState<1 | -1>(initial.dir === "asc" ? 1 : -1);
  const [team, setTeam] = useState(initial.team || "");
  const [q, setQ] = useState(initial.q || "");
  const [show, setShow] = useState(50);
  const teamById = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);

  useEffect(() => {
    const sp = new URLSearchParams({ view: "stats" });
    if (tabKey !== "QB") sp.set("pos", tabKey);
    if (sort !== tab.sort) sp.set("sort", sort);
    if (dir === 1) sp.set("dir", "asc");
    if (team) sp.set("team", team);
    if (q) sp.set("q", q);
    window.history.replaceState(null, "", `/l/${slug}/players?${sp}`);
  }, [tabKey, sort, dir, team, q, slug, tab.sort]);

  const pickTab = (k: string) => { const t = TABS.find((x) => x.key === k)!; setTabKey(k); setSort(t.sort); setDir(-1); setShow(50); };

  const list = useMemo(() => {
    const query = q.trim().toLowerCase();
    const inPos = rows.filter((r) => tab.positions.includes(r.pos) && tab.has(r.s));
    const maxVol = Math.max(0, ...inPos.map((r) => tab.volume(r.s)));
    const bar = maxVol * QUALIFY;
    const col = tab.cols.find((c) => c.key === sort) ?? tab.cols[1];
    const filtered = inPos.filter((r) => {
      if (team && String(r.t) !== team) return false;
      if (query) {
        const t = teamById.get(r.t);
        if (!`${r.n} ${t ? `${t.city} ${t.name} ${t.abbr}` : ""}`.toLowerCase().includes(query)) return false;
      }
      return true;
    });
    return filtered
      .map((r) => ({ r, v: col.get(r.s), q: !col.rate || tab.volume(r.s) >= bar }))
      .sort((a, b) => (a.q === b.q ? 0 : a.q ? -1 : 1) || (a.v - b.v) * dir || b.r.s.gp - a.r.s.gp || a.r.n.localeCompare(b.r.n));
  }, [rows, tab, sort, dir, team, q, teamById]);

  const sortCol = tab.cols.find((c) => c.key === sort);
  const clickSort = (k: string) => { if (k === sort) setDir((d) => (d === 1 ? -1 : 1)); else { setSort(k); setDir(-1); } };
  const counts = useMemo(() => Object.fromEntries(TABS.map((t) => [t.key, rows.filter((r) => t.positions.includes(r.pos) && t.has(r.s)).length])), [rows]);

  return (
    <div className="players-tool">
      <nav className="unit-tabs pl-pos-tabs" aria-label="Position">
        {TABS.map((t) => (
          <a key={t.key} href="#" aria-current={t.key === tabKey ? "page" : undefined} onClick={(e) => { e.preventDefault(); pickTab(t.key); }}>
            {t.label}<span>{counts[t.key]}</span>
          </a>
        ))}
      </nav>

      <div className="pl-filter-grid">
        <label className="pl-field grow">
          <span>Search</span>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or team" />
        </label>
        <label className="pl-field">
          <span>Team</span>
          <select value={team} onChange={(e) => setTeam(e.target.value)}>
            <option value="">All teams</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.city} {t.name}</option>)}
          </select>
        </label>
        <label className="pl-field">
          <span>Sort by</span>
          <select value={sort} onChange={(e) => { setSort(e.target.value); setDir(-1); }}>
            {tab.cols.map((c) => <option key={c.key} value={c.key}>{c.title || c.label}</option>)}
          </select>
        </label>
      </div>

      {list.length === 0 ? (
        <div className="panel"><p className="muted">{rows.length ? "No players match." : "No regular-season stats yet. Check back after week 1."}</p></div>
      ) : (
        <div className="panel pl-scroll">
          <table className="tbl pl-tbl">
            <thead>
              <tr>
                <th className="num">#</th>
                <th className="pl-name">Player</th>
                <th>Team</th>
                <th>Pos</th>
                <th className="num">Age</th>
                <th className="num">OVR</th>
                {tab.cols.map((c) => (
                  <th key={c.key} className={`num sortable${sort === c.key ? " sorted" : ""}`} title={c.title} aria-sort={sort === c.key ? (dir === 1 ? "ascending" : "descending") : undefined}>
                    <button type="button" onClick={() => clickSort(c.key)}>{c.label}<span className="sort-arrow" aria-hidden>{sort === c.key ? (dir === 1 ? "▲" : "▼") : ""}</span></button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.slice(0, show).map(({ r, q: qualified }, i) => {
                const t = teamById.get(r.t);
                const prevQ = i > 0 && list[i - 1].q;
                return (
                  <Fragment key={r.id}>
                    {sortCol?.rate && !qualified && (i === 0 || prevQ) && (
                      <tr className="pl-divider"><td colSpan={6 + tab.cols.length}>Not enough {tab.volumeLabel} to rank by {sortCol.title || sortCol.label}</td></tr>
                    )}
                    <tr className={qualified ? undefined : "pl-unq"}>
                      <td className="num muted">{qualified ? i + 1 : ""}</td>
                      <td className="pl-name">{r.gone ? <span>{r.n}</span> : <Link href={`/l/${slug}/players/${r.id}`}>{r.n}</Link>}</td>
                      <td className="nw">{t ? <Link href={`/l/${slug}/teams/${t.abbr.toLowerCase()}`} className="pl-team"><span className="pl-dot" style={{ background: t.primary }} />{t.abbr}</Link> : <span className="muted">—</span>}</td>
                      <td>{r.pos}</td>
                      <td className="num">{r.age}</td>
                      <td className="num">{r.ovr}</td>
                      {tab.cols.map((c) => {
                        const v = c.get(r.s);
                        return <td key={c.key} className={`num${sort === c.key ? " pl-sorted-cell" : ""}`}>{c.fmt ? c.fmt(v) : v}</td>;
                      })}
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {list.length > show && (
        <div className="pl-pager"><span className="muted">Showing {show} of {list.length}</span>
          <div className="pl-pages"><button type="button" onClick={() => setShow((s) => s + 50)}>Show 50 more</button><button type="button" onClick={() => setShow(list.length)}>Show all</button></div>
        </div>
      )}
      <p className="hint">
        Regular season only. Players are listed at their current position and team. Averages and percentages only rank players with at least {Math.round(QUALIFY * 100)}% of the
        position leader&apos;s volume (attempts, carries, catches, kicks or punts); everyone else is listed underneath.
      </p>
    </div>
  );
}
