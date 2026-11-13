"use client";
// Card builder (Nick's requests, 2026-11-13): the player page's card, plus, for whoever can edit
// this card (team owner or commissioner): switches for each built-in layer, fonts for the name and
// the overall/position (colors never change: white, gold at 99), and an uploaded custom border.
// Changes preview live on the card and are saved for everyone (site and Discord). Default: everything
// on, Nick's dev-trait borders, the rating art.

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PlayerCard, type PlayerCardProps } from "./PlayerCard";
import { toast } from "./Toaster";
import { CARD_FONTS, CARD_LAYERS, DEFAULT_LAYOUT, isDefaultLayout, type CardLayout } from "@/lib/league/cardLayout";

const FW = 750, FH = 1050; // card shape (5:7)

export function CardBuilder({ card, slug, playerId, canEdit }: { card: PlayerCardProps; slug: string; playerId: number; canEdit: boolean }) {
  const router = useRouter();
  const saved = card.layout ?? DEFAULT_LAYOUT;
  const [layout, setLayout] = useState<CardLayout>(saved);
  const [frame, setFrame] = useState<{ url: string; blob: Blob } | null>(null); // new border picked, not saved yet
  const [dropFrame, setDropFrame] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const dirty = JSON.stringify(layout) !== JSON.stringify(saved) || !!frame || dropFrame;
  const set = (patch: Partial<CardLayout>) => setLayout((l) => ({ ...l, ...patch }));
  const frameArt = dropFrame ? undefined : frame?.url ?? card.frameArt;

  const pickFrame = (f: File | undefined) => {
    if (!f) return;
    if (f.type !== "image/png") { toast("Borders need to be a PNG with a see-through middle.", "error"); return; }
    const img = new Image();
    img.onload = () => {
      // Stretch to the card's 5:7 shape so it lines up edge to edge, like the built-in frames.
      const c = document.createElement("canvas"); c.width = FW; c.height = FH;
      c.getContext("2d")!.drawImage(img, 0, 0, FW, FH);
      c.toBlob((b) => {
        if (!b) { toast("Couldn't read that image.", "error"); return; }
        setFrame({ url: URL.createObjectURL(b), blob: b }); setDropFrame(false);
        set({ customFrame: true, frame: true });
      }, "image/png");
    };
    img.onerror = () => toast("Couldn't open that image.", "error");
    img.src = URL.createObjectURL(f);
  };

  const save = async (next: CardLayout, reset = false) => {
    setBusy(true);
    const fail = (m: string) => { setBusy(false); toast(m, "error"); };
    if (frame && !reset) {
      const body = new FormData();
      body.append("file", new File([frame.blob], "frame.png", { type: "image/png" }));
      body.append("inset", String(next.frameInset));
      const r = await fetch(`/api/leagues/${slug}/card-art/${playerId}/frame`, { method: "POST", body }).catch(() => null);
      if (!r?.ok) return fail((await r?.json().catch(() => ({})))?.error || "Couldn't upload the border.");
    }
    if ((dropFrame || reset) && card.frameArt) await fetch(`/api/leagues/${slug}/card-art/${playerId}/frame`, { method: "DELETE" }).catch(() => null);
    const res = await fetch(`/api/leagues/${slug}/card-art/${playerId}/layout`, {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ layout: reset ? DEFAULT_LAYOUT : { ...next, customFrame: !!(frame || (card.frameArt && !dropFrame)) && next.customFrame } }),
    }).catch(() => null);
    if (!res?.ok) return fail((await res?.json().catch(() => ({})))?.error || "Couldn't save. Try again.");
    setBusy(false); setOpen(false); setFrame(null); setDropFrame(false);
    toast("Card saved");
    router.refresh();
  };
  const cancel = () => { setLayout(saved); setFrame(null); setDropFrame(false); setOpen(false); };

  return (
    <>
      <PlayerCard {...card} layout={layout} frameArt={frameArt} />
      {canEdit && !open && <button type="button" className="pcard-flip" onClick={() => setOpen(true)}>Customize card</button>}
      {canEdit && open && (
        <div className="card-builder">
          <p className="muted small">Build this card your way. Everyone sees it, on the site and in Discord.</p>

          <h4 className="cb-h">Show on the card</h4>
          <div className="cb-presets">
            <button type="button" className="chip" onClick={() => set(Object.fromEntries(CARD_LAYERS.map((l) => [l.key, true])))}>Everything</button>
            <button type="button" className="chip" onClick={() => set(Object.fromEntries(CARD_LAYERS.map((l) => [l.key, false])))}>Art only</button>
          </div>
          <ul className="cb-list">
            {CARD_LAYERS.map((l) => (
              <li key={l.key}>
                <label className="cb-row">
                  <input type="checkbox" checked={layout[l.key]} onChange={(e) => set({ [l.key]: e.target.checked })} />
                  <span className="cb-switch" aria-hidden />
                  <span><b>{l.label}</b><span className="muted small">{l.hint}</span></span>
                </label>
              </li>
            ))}
          </ul>

          <h4 className="cb-h">Border</h4>
          <input ref={fileRef} type="file" accept="image/png" hidden onChange={(e) => { pickFrame(e.target.files?.[0]); e.target.value = ""; }} />
          {layout.customFrame && frameArt ? (
            <>
              <p className="muted small">Your border. Slide until the card sits just inside it.</p>
              <label className="cb-slider">Card inset<input type="range" min={0} max={10} step={0.1} value={layout.frameInset} onChange={(e) => set({ frameInset: +e.target.value })} /><span>{layout.frameInset.toFixed(1)}</span></label>
              <div className="cb-presets">
                <button type="button" className="chip" onClick={() => fileRef.current?.click()}>Upload a different border</button>
                <button type="button" className="chip" onClick={() => { setFrame(null); setDropFrame(true); set({ customFrame: false }); }}>Use the default border</button>
              </div>
            </>
          ) : (
            <>
              <p className="muted small">Default: the {["bronze", "silver", "gold", "ruby"][card.dev] ?? "bronze"} border for this dev trait. Or upload your own: a PNG with a see-through middle, ideally 750×1050.</p>
              <div className="cb-presets"><button type="button" className="chip" onClick={() => fileRef.current?.click()}>Upload a border</button></div>
            </>
          )}

          <h4 className="cb-h">Name font</h4>
          <div className="cb-fonts">
            {CARD_FONTS.map((f) => (
              <button type="button" key={f.key} className={`cb-font ${layout.nameFont === f.key ? "on" : ""}`} style={{ fontFamily: `"${f.family}"`, fontWeight: f.weight }}
                onClick={() => set({ nameFont: f.key })}>{f.label}</button>
            ))}
          </div>

          <h4 className="cb-h">Overall + position</h4>
          <p className="muted small">Colors stay the same: white, and gold at 99.</p>
          <div className="cb-fonts">
            <button type="button" className={`cb-font ${layout.numFont === "art" ? "on" : ""}`} onClick={() => set({ numFont: "art" })}>Card art</button>
            {CARD_FONTS.map((f) => (
              <button type="button" key={f.key} className={`cb-font ${layout.numFont === f.key ? "on" : ""}`} style={{ fontFamily: `"${f.family}"`, fontWeight: f.weight }}
                onClick={() => set({ numFont: f.key })}>{f.label} 87</button>
            ))}
          </div>

          <div className="art-editor-actions">
            <button type="button" className="btn-primary" disabled={busy || !dirty} onClick={() => save(layout)}>{busy ? "Saving…" : "Save card"}</button>
            <button type="button" className="pcard-flip" disabled={busy} onClick={cancel}>Cancel</button>
            {(!isDefaultLayout(saved) || card.frameArt) && <button type="button" className="pcard-flip" disabled={busy} onClick={() => save(DEFAULT_LAYOUT, true)}>Reset to default</button>}
          </div>
        </div>
      )}
    </>
  );
}
