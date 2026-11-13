"use client";
// League-wide players table: sort by any column, filter by position group, team,
// age, contract status and more. All filtering runs in the browser; filters are
// mirrored into the URL so a filtered view can be shared.
import Link from "next/link";
import { Fragment, useEffect, useMemo, useState } from "react";
import { RATING_KEYS, RATING_LABEL, type RatingKey } from "@/lib/league/ratings";
import { RATING_GROUPS } from "@/lib/league/ratingGroups";
import { DEV_LABEL } from "@/lib/league/types";
import { heightText, money } from "@/lib/league/format";

export type TeamLite = { id: number; abbr: string; city: string; name: string; primary: string };
export type PlayerRow = {
  id: number; n: string; t: number; pos: string; age: number; ht: number; wt: number; col: string;
  ovr: number; dev: number; yp: number; yl: number; cap: number; ps: boolean; inj: boolean; dr: number; r: number[];
};

const POS_GROUPS: [string, string[]][] = [
  ["QB", ["QB"]],
  ["RB", ["HB", "FB"]],
  ["WR", ["WR"]],
  ["TE", ["TE"]],
  ["OL", ["LT", "LG", "C", "RG", "RT"]],
  ["DL", ["LEDG", "REDG", "LE", "RE", "DT"]],
  ["LB", ["SAM", "MIKE", "WILL", "LOLB", "MLB", "ROLB"]],
  ["DB", ["CB", "FS", "SS"]],
  ["K/P", ["K", "P", "LS"]],
];
const POS_ORDER = POS_GROUPS.flatMap(([, ps]) => ps);

const SHORT: Record<RatingKey, string> = {
  speedRating: "SPD", accelRating: "ACC", agilityRating: "AGI", changeOfDirectionRating: "COD", strengthRating: "STR",
  jumpRating: "JMP", staminaRating: "STA", toughRating: "TGH", injuryRating: "INJ", awareRating: "AWR",
  throwPowerRating: "THP", throwAccShortRating: "SAC", throwAccMidRating: "MAC", throwAccDeepRating: "DAC", throwAccRating: "TAC",
  throwOnRunRating: "TOR", throwUnderPressureRating: "TUP", playActionRating: "PAC", breakSackRating: "BSK",
  carryRating: "CAR", bCVRating: "BCV", breakTackleRating: "BTK", jukeMoveRating: "JKM", spinMoveRating: "SPM", stiffArmRating: "SFA", truckRating: "TRK",
  catchRating: "CTH", cITRating: "CIT", specCatchRating: "SPC", releaseRating: "RLS", routeRunShortRating: "SRR", routeRunMedRating: "MRR", routeRunDeepRating: "DRR",
  passBlockRating: "PBK", passBlockPowerRating: "PBP", passBlockFinesseRating: "PBF", runBlockRating: "RBK", runBlockPowerRating: "RBP",
  runBlockFinesseRating: "RBF", leadBlockRating: "LBK", impactBlockRating: "IBL",
  powerMovesRating: "PMV", finesseMovesRating: "FMV", blockShedRating: "BSH", tackleRating: "TAK", hitPowerRating: "POW", pursuitRating: "PUR", playRecRating: "PRC",
  manCoverRating: "MCV", zoneCoverRating: "ZCV", pressRating: "PRS",
  kickPowerRating: "KPW", kickAccRating: "KAC", kickRetRating: "RET", longSnapRating: "LSN",
  confRating: "CNF",
};
const GROUP_SHORT: Record<string, string> = {
  Physical: "Physical", Passing: "Passing", "Ball carrying": "Ball carrying", Receiving: "Receiving", Blocking: "Blocking",
  "Pass rush and run defense": "Run D / pass rush", Coverage: "Coverage", "Special teams": "Special teams", Other: "Other",
};

type SortKey = string; // "n", "team", "pos", "age", ... or "r:<index>"
type Filters = {
  q: string; grp: string; pos: string; team: string; ageMin: string; ageMax: string; ovrMin: string; dev: string;
  exp: boolean; rook: boolean; ps: "all" | "hide" | "only"; inj: boolean; und: boolean; yl: string;
};
const DEFAULTS: Filters = { q: "", grp: "", pos: "", team: "", ageMin: "", ageMax: "", ovrMin: "", dev: "", exp: false, rook: false, ps: "all", inj: false, und: false, yl: "" };
const PAGE_SIZES = [50, 100, 250, 500];

function readInitial(init: Record<string, string>) {
  const f: Filters = { ...DEFAULTS };
  for (const k of ["q", "grp", "pos", "team", "ageMin", "ageMax", "ovrMin", "dev", "yl"] as const) if (init[k]) f[k] = init[k];
  for (const k of ["exp", "rook", "inj", "und"] as const) if (init[k] === "1") f[k] = true;
  if (init.ps === "hide" || init.ps === "only") f.ps = init.ps;
  const hidden = new Set((init.hide || "").split(",").filter(Boolean));
  return { f, sort: init.sort || "ovr", dir: (init.dir === "asc" ? 1 : init.dir === "desc" ? -1 : 0) as 1 | -1 | 0, hidden, size: Number(init.size) || 100 };
}

const TEXT_SORTS = new Set(["n", "team", "pos", "col"]);
const ratingTone = (v: number) => (v >= 90 ? "rt-elite" : v >= 80 ? "rt-good" : v >= 70 ? "rt-ok" : v < 50 ? "rt-low" : "");

export function PlayersTable({ slug, teams, rows, initial }: { slug: string; teams: TeamLite[]; rows: PlayerRow[]; initial: Record<string, string> }) {
  const start = useMemo(() => readInitial(initial), [initial]);
  const [f, setF] = useState<Filters>(start.f);
  const [sort, setSort] = useState<SortKey>(start.sort);
  const [dir, setDir] = useState<1 | -1>(start.dir || (TEXT_SORTS.has(start.sort) ? 1 : -1));
  const [hidden, setHidden] = useState<Set<string>>(start.hidden);
  const [size, setSize] = useState(PAGE_SIZES.includes(start.size) ? start.size : 100);
  const [page, setPage] = useState(0);
  const [showMore, setShowMore] = useState(Boolean(start.f.ageMin || start.f.ageMax || start.f.ovrMin || start.f.dev || start.f.yl || start.f.inj || start.f.und || start.f.ps !== "all"));

  const teamById = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);
  const hasRatings = rows.some((r) => r.r.length);
  const colleges = useMemo(() => [...new Set(rows.map((r) => r.col).filter(Boolean))].sort(), [rows]);

  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => { setF((o) => ({ ...o, [k]: v })); setPage(0); };

  // Mirror the view into the URL (replaceState, so Back still leaves the page).
  useEffect(() => {
    const sp = new URLSearchParams();
    (Object.keys(DEFAULTS) as (keyof Filters)[]).forEach((k) => {
      const v = f[k];
      if (v === DEFAULTS[k]) return;
      sp.set(k, typeof v === "boolean" ? "1" : String(v));
    });
    if (sort !== "ovr") sp.set("sort", sort);
    if (!(sort === "ovr" && dir === -1)) sp.set("dir", dir === 1 ? "asc" : "desc");
    if (hidden.size) sp.set("hide", [...hidden].join(","));
    if (size !== 100) sp.set("size", String(size));
    const s = sp.toString();
    window.history.replaceState(null, "", `/l/${slug}/players${s ? `?${s}` : ""}`);
  }, [f, sort, dir, hidden, size, slug]);

  const filtered = useMemo(() => {
    const q = f.q.trim().toLowerCase();
    const grpPos = POS_GROUPS.find(([g]) => g === f.grp)?.[1];
    const ageMin = Number(f.ageMin) || 0, ageMax = Number(f.ageMax) || 99, ovrMin = Number(f.ovrMin) || 0;
    const teamId = f.team === "fa" ? 0 : Number(f.team) || null;
    return rows.filter((r) => {
      if (f.team === "") { if (!r.t) return false; }
      else if (r.t !== teamId) return false;
      if (grpPos && !grpPos.includes(r.pos)) return false;
      if (f.pos && r.pos !== f.pos) return false;
      if (r.age < ageMin || r.age > ageMax || r.ovr < ovrMin) return false;
      if (f.dev === "star+" ? r.dev < 1 : f.dev !== "" && r.dev !== Number(f.dev)) return false;
      if (f.exp && !(r.t && !r.ps && r.yl <= 1)) return false;
      if (f.yl && !(r.t && !r.ps && r.yl === Number(f.yl))) return false;
      if (f.rook && r.yp !== 0) return false;
      if (f.ps === "hide" && r.ps) return false;
      if (f.ps === "only" && !r.ps) return false;
      if (f.inj && !r.inj) return false;
      if (f.und && r.dr !== 0) return false;
      if (q) {
        const t = teamById.get(r.t);
        const hay = `${r.n} ${r.col} ${t ? `${t.city} ${t.name} ${t.abbr}` : "free agent"}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, f, teamById]);

  const sorted = useMemo(() => {
    const val = (r: PlayerRow): string | number => {
      if (sort.startsWith("r:")) return r.r[Number(sort.slice(2))] ?? -1;
      switch (sort) {
        case "n": { const sp = r.n.indexOf(" "); return `${r.n.slice(sp + 1)} ${r.n.slice(0, sp)}`.toLowerCase(); }
        case "team": return teamById.get(r.t)?.abbr ?? "~";
        case "pos": { const i = POS_ORDER.indexOf(r.pos); return i < 0 ? 99 : i; }
        case "col": return r.col.toLowerCase() || "~";
        case "yl": return r.t && !r.ps ? r.yl : -1;
        case "cap": return r.t ? r.cap : -1;
        default: return (r as unknown as Record<string, number>)[sort] ?? 0;
      }
    };
    const out = [...filtered];
    out.sort((a, b) => {
      const va = val(a), vb = val(b);
      const c = typeof va === "string" ? va.localeCompare(vb as string) : (va as number) - (vb as number);
      return c * dir || b.ovr - a.ovr || a.n.localeCompare(b.n);
    });
    return out;
  }, [filtered, sort, dir, teamById]);

  const pages = Math.max(1, Math.ceil(sorted.length / size));
  const pg = Math.min(page, pages - 1);
  const shown = sorted.slice(pg * size, pg * size + size);

  const clickSort = (k: SortKey) => {
    if (k === sort) setDir((d) => (d === 1 ? -1 : 1));
    else { setSort(k); setDir(TEXT_SORTS.has(k) ? 1 : -1); }
    setPage(0);
  };
  const th = (k: SortKey, label: string, title?: string, cls = "num") => (
    <th className={`${cls} sortable${sort === k ? " sorted" : ""}`} title={title} aria-sort={sort === k ? (dir === 1 ? "ascending" : "descending") : undefined}>
      <button type="button" onClick={() => clickSort(k)}>{label}<span className="sort-arrow" aria-hidden>{sort === k ? (dir === 1 ? "▲" : "▼") : ""}</span></button>
    </th>
  );

  const groups = RATING_GROUPS.filter(([g]) => !hidden.has(g));
  const toggleGroup = (g: string) => setHidden((h) => { const n = new Set(h); if (n.has(g)) n.delete(g); else n.add(g); return n; });
  const posChoices = f.grp ? POS_GROUPS.find(([g]) => g === f.grp)?.[1].filter((p) => rows.some((r) => r.pos === p)) ?? [] : [];
  const activeCount = (Object.keys(DEFAULTS) as (keyof Filters)[]).filter((k) => f[k] !== DEFAULTS[k]).length;

  return (
    <div className="players-tool">
      <div className="filters">
        <nav className="week-chips" aria-label="Position group">
          {["", ...POS_GROUPS.map(([g]) => g)].map((g) => (
            <a key={g || "all"} href="#" aria-current={f.grp === g ? "page" : undefined} onClick={(e) => { e.preventDefault(); setF((o) => ({ ...o, grp: g, pos: "" })); setPage(0); }}>{g || "All"}</a>
          ))}
        </nav>
        {posChoices.length > 1 && (
          <nav className="week-chips sub" aria-label="Position">
            {["", ...posChoices].map((p) => (
              <a key={p || "all"} href="#" aria-current={f.pos === p ? "page" : undefined} onClick={(e) => { e.preventDefault(); set("pos", p); }}>{p || `All ${f.grp}`}</a>
            ))}
          </nav>
        )}

        <div className="pl-filter-grid">
          <label className="pl-field grow">
            <span>Search</span>
            <input type="search" value={f.q} onChange={(e) => set("q", e.target.value)} placeholder="Name, team or college" list="pl-colleges" />
            <datalist id="pl-colleges">{colleges.map((c) => <option key={c} value={c} />)}</datalist>
          </label>
          <label className="pl-field">
            <span>Team</span>
            <select value={f.team} onChange={(e) => set("team", e.target.value)}>
              <option value="">All rosters</option>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.city} {t.name}</option>)}
              <option value="fa">Free agents</option>
            </select>
          </label>
          <div className="pl-checks">
            <label className="pl-check"><input type="checkbox" checked={f.exp} onChange={(e) => set("exp", e.target.checked)} /> Expiring contracts</label>
            <label className="pl-check"><input type="checkbox" checked={f.rook} onChange={(e) => set("rook", e.target.checked)} /> Rookies</label>
            <button type="button" className="pl-more" aria-expanded={showMore} onClick={() => setShowMore((s) => !s)}>{showMore ? "Fewer filters" : "More filters"} ▾</button>
          </div>
        </div>

        {showMore && (
          <div className="pl-filter-grid more">
            <div className="pl-field pair">
              <span>Age</span>
              <div><input type="number" inputMode="numeric" min={18} max={50} value={f.ageMin} onChange={(e) => set("ageMin", e.target.value)} placeholder="Min" aria-label="Minimum age" />
                <span className="muted">to</span>
                <input type="number" inputMode="numeric" min={18} max={50} value={f.ageMax} onChange={(e) => set("ageMax", e.target.value)} placeholder="Max" aria-label="Maximum age" /></div>
            </div>
            <label className="pl-field narrow">
              <span>Overall at least</span>
              <input type="number" inputMode="numeric" min={0} max={99} value={f.ovrMin} onChange={(e) => set("ovrMin", e.target.value)} placeholder="Any" />
            </label>
            <label className="pl-field">
              <span>Dev trait</span>
              <select value={f.dev} onChange={(e) => set("dev", e.target.value)}>
                <option value="">Any</option>
                <option value="star+">Star or better</option>
                {DEV_LABEL.map((d, i) => <option key={d} value={i}>{d}</option>)}
              </select>
            </label>
            <label className="pl-field">
              <span>Years left</span>
              <select value={f.yl} onChange={(e) => set("yl", e.target.value)}>
                <option value="">Any</option>
                {[1, 2, 3, 4, 5, 6, 7].map((n) => <option key={n} value={n}>{n} year{n === 1 ? "" : "s"}</option>)}
              </select>
            </label>
            <label className="pl-field">
              <span>Practice squad</span>
              <select value={f.ps} onChange={(e) => set("ps", e.target.value as Filters["ps"])}>
                <option value="all">Include</option>
                <option value="hide">Hide</option>
                <option value="only">Only practice squad</option>
              </select>
            </label>
            <div className="pl-checks">
              <label className="pl-check"><input type="checkbox" checked={f.inj} onChange={(e) => set("inj", e.target.checked)} /> Injured</label>
              <label className="pl-check"><input type="checkbox" checked={f.und} onChange={(e) => set("und", e.target.checked)} /> Undrafted</label>
            </div>
          </div>
        )}

        {hasRatings && (
          <div className="pl-cols">
            <span className="muted small">Rating columns:</span>
            {RATING_GROUPS.map(([g]) => (
              <button key={g} type="button" className={`pl-col-chip${hidden.has(g) ? "" : " on"}`} aria-pressed={!hidden.has(g)} onClick={() => toggleGroup(g)}>{GROUP_SHORT[g] || g}</button>
            ))}
            {hidden.size > 0
              ? <button type="button" className="pl-link" onClick={() => setHidden(new Set())}>Show all</button>
              : <button type="button" className="pl-link" onClick={() => setHidden(new Set(RATING_GROUPS.map(([g]) => g)))}>Hide all</button>}
          </div>
        )}

        <div className="pl-summary">
          <span><strong>{sorted.length.toLocaleString()}</strong> player{sorted.length === 1 ? "" : "s"}</span>
          {activeCount > 0 && <button type="button" className="pl-link" onClick={() => { setF(DEFAULTS); setPage(0); }}>Clear {activeCount} filter{activeCount === 1 ? "" : "s"}</button>}
        </div>
      </div>

      <div className="panel pl-scroll">
        <table className="tbl pl-tbl">
          <thead>
            {hasRatings && groups.length > 0 && (
              <tr className="pl-group-row">
                <th colSpan={14} className="pl-sticky-cell" />
                {groups.map(([g, keys]) => <th key={g} colSpan={keys.length} className="pl-group">{GROUP_SHORT[g] || g}</th>)}
              </tr>
            )}
            <tr>
              {th("n", "Player", "Sort by last name", "pl-name")}
              {th("team", "Team", undefined, "")}
              {th("pos", "Pos", "Position", "")}
              {th("ovr", "OVR", "Overall")}
              {th("dev", "Dev", "Dev trait", "")}
              {th("age", "Age")}
              {th("ht", "Ht", "Height")}
              {th("wt", "Wt", "Weight")}
              {th("col", "College", undefined, "")}
              {th("yp", "Exp", "Years pro (0 = rookie)")}
              {th("dr", "Rd", "Draft round (0 = undrafted)")}
              {th("yl", "Yrs left", "Years left on contract")}
              {th("cap", "Cap hit", "This season's cap hit")}
              <th className="pl-flags" />
              {groups.flatMap(([, keys]) => keys).map((k) => {
                const i = RATING_KEYS.indexOf(k);
                return <Fragment key={k}>{th(`r:${i}`, SHORT[k], RATING_LABEL[k])}</Fragment>;
              })}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const t = teamById.get(r.t);
              return (
                <tr key={r.id}>
                  <td className="pl-name"><Link href={`/l/${slug}/players/${r.id}`}>{r.n}</Link></td>
                  <td className="nw">{t ? <Link href={`/l/${slug}/teams/${t.abbr.toLowerCase()}`} className="pl-team"><span className="pl-dot" style={{ background: t.primary }} />{t.abbr}</Link> : <span className="muted">FA</span>}</td>
                  <td>{r.pos}</td>
                  <td className="num strong">{r.ovr}</td>
                  <td className="nw">{r.dev ? <span className={`dev dev-${r.dev}`}>{DEV_LABEL[r.dev]}</span> : <span className="muted small">Normal</span>}</td>
                  <td className="num">{r.age}</td>
                  <td className="num">{heightText(r.ht)}</td>
                  <td className="num">{r.wt}</td>
                  <td className="nw pl-col">{r.col || <span className="muted">—</span>}</td>
                  <td className="num">{r.yp === 0 ? <span className="tag">R</span> : r.yp}</td>
                  <td className="num">{r.dr || <span className="muted">UDFA</span>}</td>
                  <td className="num">{!r.t ? <span className="muted">—</span> : r.ps ? <span className="muted small">PS</span> : <span className={r.yl <= 1 ? "pl-exp" : undefined}>{r.yl}</span>}</td>
                  <td className="num">{r.t && !r.ps ? money(r.cap) : <span className="muted">—</span>}</td>
                  <td className="pl-flags">{r.ps && <span className="tag" title="Practice squad">PS</span>}{r.inj && <span className="tag inj" title="Injured">INJ</span>}</td>
                  {groups.flatMap(([, keys]) => keys).map((k) => {
                    const v = r.r[RATING_KEYS.indexOf(k)];
                    return <td key={k} className={`num rt ${v != null ? ratingTone(v) : ""}`}>{v ?? "—"}</td>;
                  })}
                </tr>
              );
            })}
            {shown.length === 0 && (
              <tr><td colSpan={14 + groups.reduce((s, [, k]) => s + k.length, 0)} className="muted" style={{ padding: 24 }}>No players match these filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="pl-pager">
        <label className="pl-field inline">
          <span>Per page</span>
          <select value={size} onChange={(e) => { setSize(Number(e.target.value)); setPage(0); }}>
            {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        {pages > 1 && (
          <div className="pl-pages">
            <button type="button" disabled={pg === 0} onClick={() => setPage(pg - 1)}>‹ Prev</button>
            <span>Page {pg + 1} of {pages}</span>
            <button type="button" disabled={pg >= pages - 1} onClick={() => setPage(pg + 1)}>Next ›</button>
          </div>
        )}
      </div>
      <p className="hint">
        Expiring = 1 year or less left on a rostered player&apos;s deal (practice squad excluded). Rookies = first-year players.
        Ratings are color-coded: 90+ elite, 80s good, 70s solid, under 50 low. Hover a rating header for its full name.
      </p>
    </div>
  );
}
