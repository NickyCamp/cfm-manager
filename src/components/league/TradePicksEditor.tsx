"use client";
// Commissioners add the draft picks a synced trade included (EA's export has none). Nick, 2026-11-17.
import { useState } from "react";
import { useRouter } from "next/navigation";

const ROUNDS = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th"];

export function TradePicksEditor({ slug, tradeKey, teams, initial, firstYear, allAbbrs = [] }: {
  slug: string; tradeKey: string; teams: { id: number; abbr: string }[]; initial: Record<string, string[]>; firstYear: number; allAbbrs?: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [picks, setPicks] = useState<Record<string, string[]>>(initial);
  // via: whose pick it originally was ("" = the other team's own), for the pick tracker.
  const [form, setForm] = useState<Record<string, { y: number; r: number; n: string; via: string }>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const years = [firstYear, firstYear + 1, firstYear + 2, firstYear + 3];
  const has = Object.values(initial).some((l) => l.length);

  if (!open) return <button type="button" className="toggle-link small" onClick={() => setOpen(true)}>{has ? "Edit picks" : "Add picks"}</button>;

  const f = (t: number) => form[t] || { y: firstYear, r: 1, n: "", via: "" };
  const add = (t: number) => {
    const x = f(t);
    const extra = [x.n ? `#${x.n}` : "", x.via ? `via ${x.via}` : ""].filter(Boolean).join(", ");
    const label = `${x.y} ${ROUNDS[x.r - 1]} round pick${extra ? ` (${extra})` : ""}`;
    setPicks((p) => ({ ...p, [t]: [...(p[t] || []), label] }));
  };
  const save = async () => {
    setBusy(true); setMsg("");
    const res = await fetch(`/api/leagues/${slug}/trade-picks`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: tradeKey, picks }) });
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (!res.ok) { setMsg(j.error || "Couldn't save."); return; }
    setOpen(false);
    router.refresh();
  };

  return (
    <div className="panel" style={{ marginTop: 8, padding: 10 }}>
      <p className="small muted" style={{ margin: "0 0 6px" }}>Picks each team received in this trade (EA&apos;s data doesn&apos;t include them).</p>
      {teams.map((t) => (
        <div key={t.id} style={{ marginBottom: 8 }}>
          <strong>{t.abbr} got:</strong>{" "}
          {(picks[t.id] || []).map((p, i) => (
            <span key={i} className="small" style={{ marginRight: 8 }}>
              {p} <button type="button" className="toggle-link" aria-label={`Remove ${p}`} onClick={() => setPicks((q) => ({ ...q, [t.id]: (q[t.id] || []).filter((_, j) => j !== i) }))}>×</button>
            </span>
          ))}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
            <select aria-label="Year" value={f(t.id).y} onChange={(e) => setForm((s) => ({ ...s, [t.id]: { ...f(t.id), y: Number(e.target.value) } }))}>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <select aria-label="Round" value={f(t.id).r} onChange={(e) => setForm((s) => ({ ...s, [t.id]: { ...f(t.id), r: Number(e.target.value) } }))}>
              {ROUNDS.map((r, i) => <option key={r} value={i + 1}>{r} round</option>)}
            </select>
            <input aria-label="Pick number (optional)" placeholder="Pick # (optional)" inputMode="numeric" style={{ width: 130 }}
              value={f(t.id).n} onChange={(e) => setForm((s) => ({ ...s, [t.id]: { ...f(t.id), n: e.target.value.replace(/\D/g, "").slice(0, 3) } }))} />
            {allAbbrs.length > 0 && (
              <select aria-label="Whose pick" value={f(t.id).via} onChange={(e) => setForm((s) => ({ ...s, [t.id]: { ...f(t.id), via: e.target.value } }))}>
                <option value="">{teams.find((x) => x.id !== t.id)?.abbr || "their"}&apos;s own</option>
                {allAbbrs.filter((a) => a !== teams.find((x) => x.id !== t.id)?.abbr).map((a) => <option key={a} value={a}>via {a}</option>)}
              </select>
            )}
            <button type="button" className="btn btn-quiet" onClick={() => add(t.id)}>Add</button>
          </div>
        </div>
      ))}
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button type="button" className="btn" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save picks"}</button>
        <button type="button" className="btn btn-quiet" onClick={() => { setPicks(initial); setOpen(false); }}>Cancel</button>
        {msg && <span className="small neg">{msg}</span>}
      </div>
    </div>
  );
}
