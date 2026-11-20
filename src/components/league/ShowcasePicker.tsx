"use client";
// Team Roster tab: the team's manager (or the commissioner) picks which 5 cards the showcase
// stack shows, in order. Tap players to add them; the order they're tapped is the order shown.
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "./Toaster";
import { DevTag } from "./bits";

type Option = { id: number; name: string; pos: string; ovr: number; dev: number };
const MAX = 5;

export function ShowcasePicker({ slug, teamId, players, saved }: { slug: string; teamId: number; players: Option[]; saved: number[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [picks, setPicks] = useState<number[]>(saved);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? players.filter((p) => p.name.toLowerCase().includes(s) || p.pos.toLowerCase() === s) : players;
  }, [players, q]);

  const toggle = (id: number) => {
    if (picks.includes(id)) { setMsg(""); setPicks(picks.filter((x) => x !== id)); return; }
    if (picks.length >= MAX) { setMsg(`You can pick ${MAX}. Remove one first.`); return; }
    setMsg(""); setPicks([...picks, id]);
  };
  const move = (i: number, dir: -1 | 1) => setPicks((cur) => {
    const j = i + dir;
    if (j < 0 || j >= cur.length) return cur;
    const next = [...cur];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });

  const save = async (reset: boolean) => {
    if (!reset && !picks.length) { setMsg("Pick at least one card."); return; }
    setBusy(true); setMsg("");
    const res = await fetch(`/api/leagues/${slug}/teams/${teamId}/showcase`, {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(reset ? { reset: true } : { ids: picks }),
    }).catch(() => null);
    const j = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res?.ok) { setMsg(j.error || "Couldn't save. Try again."); return; }
    if (reset) setPicks([]);
    setOpen(false);
    toast(reset ? "Showcase reset to top 5" : "Showcase saved");
    router.refresh();
  };

  if (!open) {
    return (
      <button type="button" className="btn-link sc-open" onClick={() => { setPicks(saved); setOpen(true); }}>
        {saved.length ? "Change showcase" : "Choose showcase cards"}
      </button>
    );
  }
  return (
    <div className="sc-picker panel" role="dialog" aria-label="Choose showcase cards">
      <div className="sc-head">
        <strong>Showcase <span className="muted small">{picks.length} of {MAX} · tap players in the order you want them</span></strong>
      </div>
      <ol className="sc-picks">
        {Array.from({ length: MAX }, (_, i) => {
          const p = byId.get(picks[i]);
          return (
            <li key={i} className={p ? "" : "empty"}>
              <span className="sc-n">{i + 1}</span>
              {p ? <>
                <span className="sc-name">{p.name} <span className="muted small">{p.pos} · {p.ovr}</span></span>
                <button type="button" className="sc-mini" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${p.name} up`}>↑</button>
                <button type="button" className="sc-mini" onClick={() => move(i, 1)} disabled={i === picks.length - 1} aria-label={`Move ${p.name} down`}>↓</button>
                <button type="button" className="sc-mini" onClick={() => toggle(p.id)} aria-label={`Remove ${p.name}`}>✕</button>
              </> : <span className="muted small">{i < picks.length + 1 ? "Tap a player below" : ""}</span>}
            </li>
          );
        })}
      </ol>
      <input className="sc-search" type="search" placeholder="Search name or position (e.g. WR)" value={q} onChange={(e) => setQ(e.target.value)} />
      <ul className="sc-list">
        {shown.map((p) => {
          const n = picks.indexOf(p.id);
          return (
            <li key={p.id}>
              <button type="button" className={n >= 0 ? "on" : ""} aria-pressed={n >= 0} onClick={() => toggle(p.id)}>
                <span className="sc-badge">{n >= 0 ? n + 1 : ""}</span>
                <span className="sc-name">{p.name}</span>
                <span className="muted small">{p.pos}</span>
                <DevTag dev={p.dev} />
                <span className="sc-ovr">{p.ovr}</span>
              </button>
            </li>
          );
        })}
        {!shown.length && <li className="muted small">No players match.</li>}
      </ul>
      {msg && <p className="error small">{msg}</p>}
      <div className="sc-actions">
        <button type="button" className="btn btn-primary" disabled={busy || !picks.length} onClick={() => save(false)}>{busy ? "Saving…" : "Save showcase"}</button>
        {saved.length > 0 && <button type="button" className="btn-link" disabled={busy} onClick={() => save(true)}>Reset to top 5</button>}
        <button type="button" className="btn-link" disabled={busy} onClick={() => { setOpen(false); setMsg(""); }}>Cancel</button>
      </div>
    </div>
  );
}
