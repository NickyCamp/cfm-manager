"use client";
// Card builder (Nick's request, 2026-11-13): the player page's card, plus, for whoever can edit
// this card (team owner or commissioner), switches for each built-in layer. Changes preview live
// on the card and are saved for everyone (site and Discord). Default is everything on.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PlayerCard, type PlayerCardProps } from "./PlayerCard";
import { toast } from "./Toaster";
import { CARD_LAYERS, DEFAULT_LAYOUT, isDefaultLayout, type CardLayout } from "@/lib/league/cardLayout";

export function CardBuilder({ card, slug, playerId, canEdit }: { card: PlayerCardProps; slug: string; playerId: number; canEdit: boolean }) {
  const router = useRouter();
  const saved = card.layout ?? DEFAULT_LAYOUT;
  const [layout, setLayout] = useState<CardLayout>(saved);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const dirty = CARD_LAYERS.some((l) => layout[l.key] !== saved[l.key]);

  const save = async (next: CardLayout) => {
    setBusy(true);
    const res = await fetch(`/api/leagues/${slug}/card-art/${playerId}/layout`, {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ layout: next }),
    }).catch(() => null);
    const j = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res?.ok) { toast(j.error || "Couldn't save. Try again.", "error"); return; }
    setOpen(false);
    toast("Card layout saved");
    router.refresh();
  };

  return (
    <>
      <PlayerCard {...card} layout={layout} />
      {canEdit && !open && <button type="button" className="pcard-flip" onClick={() => setOpen(true)}>Customize card</button>}
      {canEdit && open && (
        <div className="card-builder">
          <p className="muted small">Pick what shows on this card. Everyone sees it, on the site and in Discord.</p>
          <div className="cb-presets">
            <button type="button" className="chip" onClick={() => setLayout(DEFAULT_LAYOUT)}>Everything</button>
            <button type="button" className="chip" onClick={() => setLayout(Object.fromEntries(CARD_LAYERS.map((l) => [l.key, false])) as CardLayout)}>Art only</button>
          </div>
          <ul className="cb-list">
            {CARD_LAYERS.map((l) => (
              <li key={l.key}>
                <label className="cb-row">
                  <input type="checkbox" checked={layout[l.key]} onChange={(e) => setLayout({ ...layout, [l.key]: e.target.checked })} />
                  <span className="cb-switch" aria-hidden />
                  <span><b>{l.label}</b><span className="muted small">{l.hint}</span></span>
                </label>
              </li>
            ))}
          </ul>
          <div className="art-editor-actions">
            <button type="button" className="btn-primary" disabled={busy || !dirty} onClick={() => save(layout)}>{busy ? "Saving…" : "Save layout"}</button>
            <button type="button" className="pcard-flip" disabled={busy} onClick={() => { setLayout(saved); setOpen(false); }}>Cancel</button>
            {!isDefaultLayout(saved) && <button type="button" className="pcard-flip" disabled={busy} onClick={() => save(DEFAULT_LAYOUT)}>Reset to default</button>}
          </div>
        </div>
      )}
    </>
  );
}
