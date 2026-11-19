"use client";
// Commissioners record a pick changing hands (or undo one) for the pick tracker. Nick, 2026-11-18.
import { useState } from "react";
import { useRouter } from "next/navigation";

const ROUNDS = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th"];
type Move = { id: string; text: string; src: string; note: string; by: string; at: string };

export function PickMovesEditor({ slug, years, teams, owners, moves }: {
  slug: string; years: number[]; teams: { id: number; abbr: string }[]; owners: Record<string, number>; moves: Move[];
}) {
  const router = useRouter();
  const [y, setY] = useState(years[0]);
  const [r, setR] = useState(1);
  const [o, setO] = useState(teams[0]?.id ?? 0);
  const [to, setTo] = useState(0);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const owner = owners[`${y}-${r}-${o}`] ?? o;
  const abbr = (id: number) => teams.find((t) => t.id === id)?.abbr || "?";

  const send = async (body: Record<string, unknown>) => {
    setBusy(true); setMsg("");
    const res = await fetch(`/api/leagues/${slug}/picks`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (!res.ok) { setMsg(j.error || "Couldn't save."); return false; }
    router.refresh();
    return true;
  };

  return (
    <section className="panel">
      <h3 style={{ marginTop: 0 }}>Record a pick move</h3>
      <p className="small muted" style={{ marginTop: 0 }}>
        For a pick trade the site couldn&apos;t see (made in Madden without an approved proposal, or a synced trade&apos;s picks), or to fix the tracker.
        Synced trades can also get their picks on the Transactions tab (Add picks on the trade).
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <select aria-label="Draft year" value={y} onChange={(e) => setY(Number(e.target.value))}>{years.map((x) => <option key={x} value={x}>{x}</option>)}</select>
        <select aria-label="Round" value={r} onChange={(e) => setR(Number(e.target.value))}>{ROUNDS.map((x, i) => <option key={x} value={i + 1}>{x} round</option>)}</select>
        <label className="small">whose pick
          {" "}<select aria-label="Original team" value={o} onChange={(e) => setO(Number(e.target.value))}>{teams.map((t) => <option key={t.id} value={t.id}>{t.abbr}</option>)}</select>
        </label>
        <span className="small muted">now with <strong>{abbr(owner)}</strong> →</span>
        <select aria-label="New owner" value={to} onChange={(e) => setTo(Number(e.target.value))}>
          <option value={0}>to team…</option>
          {teams.filter((t) => t.id !== owner).map((t) => <option key={t.id} value={t.id}>{t.abbr}</option>)}
        </select>
        <input aria-label="Note" placeholder="Note (optional)" value={note} maxLength={80} onChange={(e) => setNote(e.target.value)} style={{ minWidth: 180 }} />
        <button type="button" className="btn" disabled={busy || !to} onClick={async () => { if (await send({ action: "add", y, r, o, to, note })) { setNote(""); setTo(0); } }}>{busy ? "Saving…" : "Record"}</button>
        {msg && <span className="small neg">{msg}</span>}
      </div>

      {moves.length > 0 && (
        <>
          <h4>Recorded moves</h4>
          <ul className="small" style={{ paddingLeft: 18 }}>
            {moves.map((m) => (
              <li key={m.id} style={{ marginBottom: 4 }}>
                {m.text}
                <span className="muted"> · {m.src === "proposal" ? "approved picks-only trade" : `by ${m.by || "a commissioner"}`}{m.note ? ` · ${m.note}` : ""} · {new Date(m.at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                {" "}<button type="button" className="toggle-link" disabled={busy} onClick={() => { if (confirm("Undo this pick move?")) void send({ action: "remove", id: m.id }); }}>Undo</button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
