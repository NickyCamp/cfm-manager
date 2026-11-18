"use client";
// Rule audits editor (/l/<slug>/admin/audit). Saves leagues.settings.audit through the admin API.
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { AuditRules } from "@/lib/league/audit";

const pct = (x: number) => String(Math.round(x * 1000) / 10);

export function AuditRulesForm({ slug, rules, titles }: { slug: string; rules: AuditRules; titles: string[] }) {
  const router = useRouter();
  const [r, setR] = useState(rules);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [g, setG] = useState({
    gameCatches: String(rules.games.gameCatches), gameShare: pct(rules.games.gameShare),
    seasonShare: pct(rules.games.seasonShare), passTdShare: pct(rules.games.passTdShare),
  });
  const ab = (k: keyof AuditRules["abilities"], v: string) => setR((x) => ({ ...x, abilities: { ...x.abilities, [k]: v } }));
  const pos = (patch: Partial<AuditRules["positions"]>) => setR((x) => ({ ...x, positions: { ...x.positions, ...patch } }));
  const gm = (patch: Partial<AuditRules["games"]>) => setR((x) => ({ ...x, games: { ...x.games, ...patch } }));

  const save = async (reset = false) => {
    setBusy(true); setMsg({ ok: true, text: "Saving…" });
    const body = reset ? { action: "audit", reset: true } : {
      action: "audit",
      rules: { ...r, games: { ...r.games, gameCatches: Number(g.gameCatches), gameShare: Number(g.gameShare) / 100, seasonShare: Number(g.seasonShare) / 100, passTdShare: Number(g.passTdShare) / 100 } },
    };
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(slug)}/admin`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = await res.json().catch(() => ({}));
      setMsg(res.ok ? { ok: true, text: j.text || "Saved." } : { ok: false, text: j.error || "That didn't work." });
      if (res.ok) { if (reset) window.location.reload(); else router.refresh(); }
    } catch { setMsg({ ok: false, text: "Couldn't reach the server." }); }
    finally { setBusy(false); }
  };

  return (
    <form className="admin-panel audit-form" onSubmit={(e) => { e.preventDefault(); save(); }}>
      <datalist id="ability-titles">{titles.map((t) => <option key={t} value={t} />)}</datalist>

      <h4>Abilities</h4>
      <div className="audit-cols">
        <label>
          <span>Banned <span className="muted small">one per line · <code>Bazooka unless THP 96</code> allows it at 96+ · <code>Backyard*</code> matches anything starting with Backyard</span></span>
          <textarea rows={10} value={r.abilities.banned} onChange={(e) => ab("banned", e.target.value)} spellCheck={false} />
        </label>
        <label>
          <span>Limited to 1 per roster <span className="muted small"><code>Acrobat (per side)</code> = 1 on offense and 1 on defense · <code>Lurker / Lurk Artist</code> = 1 between them · <code>Juke Box max 2</code> · lines starting with # are notes</span></span>
          <textarea rows={10} value={r.abilities.limited} onChange={(e) => ab("limited", e.target.value)} spellCheck={false} />
        </label>
      </div>
      <p className="muted small">Bronze, Silver and Gold all count. Practice-squad players count toward the roster. Ability names: <input list="ability-titles" placeholder="look up a name…" aria-label="Look up an ability name" /></p>

      <h4>Position changes</h4>
      <label className="audit-wide">
        <span>Allowed moves <span className="muted small">one per line: <code>DT -&gt; EDGE</code>, <code>OL &lt;-&gt; OL</code> (both ways), <code>EDGE -&gt; DT if WT &gt;= 280</code>, <code>CB -&gt; S if AGE &gt;= 30 and SPD &lt;= 87</code>. Groups: OL, OT, OG, LB, OLB, EDGE, DL, S, DB. Checks use the player just before the move: WT, HT (inches), AGE, OVR or any rating (SPD, STR, THP…). Anything not listed is not allowed (so K/P can&apos;t change).</span></span>
        <textarea rows={8} value={r.positions.changes} onChange={(e) => pos({ changes: e.target.value })} spellCheck={false} />
      </label>
      <div className="admin-row">
        <label>Changes allowed through Week <input inputMode="numeric" value={r.positions.lastWeek} onChange={(e) => pos({ lastWeek: Number(e.target.value.replace(/\D/g, "")) || 0 })} /></label>
        <label><input type="checkbox" checked={r.positions.eliteOnce} onChange={(e) => pos({ eliteOnce: e.target.checked })} /> Superstar / X-Factor players change once per season (free agency through the re-sign stage)</label>
      </div>
      <p className="muted small">Preseason and the offseason are open; the playoffs are always closed.</p>

      <h4>Games <span className="muted small">(user games only; simmed games are left out)</span></h4>
      <div className="admin-row">
        <label>A player with <input inputMode="numeric" value={g.gameCatches} onChange={(e) => setG({ ...g, gameCatches: e.target.value })} /> + catches in a game can have at most <input inputMode="decimal" value={g.gameShare} onChange={(e) => setG({ ...g, gameShare: e.target.value })} /> % of his team&apos;s catches</label>
      </div>
      <div className="admin-row">
        <label>Season: no player over <input inputMode="decimal" value={g.seasonShare} onChange={(e) => setG({ ...g, seasonShare: e.target.value })} /> % of team catches</label>
        <label>Passing TDs at most <input inputMode="decimal" value={g.passTdShare} onChange={(e) => setG({ ...g, passTdShare: e.target.value })} /> % of passing + rushing TDs</label>
      </div>
      <div className="admin-row">
        <label><input type="checkbox" checked={r.games.includeUnknown} onChange={(e) => gm({ includeUnknown: e.target.checked })} /> Count games whose sim status the site never saw as user games</label>
        <label><input type="checkbox" checked={r.games.includePlayoffs} onChange={(e) => gm({ includePlayoffs: e.target.checked })} /> Include the playoffs</label>
      </div>

      <div className="admin-row">
        <button className="btn" disabled={busy}>Save rules</button>
        <button type="button" className="btn ghost" disabled={busy} onClick={() => { if (confirm("Put back the default (NCL) rules?")) save(true); }}>Reset to defaults</button>
        {msg && <p className={`mk-msg ${msg.ok ? "ok" : "err"}`} role="status">{msg.text}</p>}
      </div>
    </form>
  );
}
