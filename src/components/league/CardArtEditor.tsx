"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { HoldButton } from "./HoldButton";
import { toast } from "./Toaster";

const W = 750, H = 1050; // 5:7, the card's shape

/** Members-only: pick a photo, line it up in the card's 5:7 frame, upload the crop. */
export function CardArtEditor({ slug, playerId, hasArt }: { slug: string; playerId: number; hasArt: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [fit, setFit] = useState({ x: 50, y: 30, zoom: 100 });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const canvas = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const c = canvas.current;
    if (!c || !img) return;
    draw(c, img, fit);
  }, [img, fit, open]);

  const pick = (f: File | undefined) => {
    if (!f) return;
    if (!f.type.startsWith("image/")) { setMsg("Pick an image file."); return; }
    const url = URL.createObjectURL(f);
    const i = new Image();
    i.onload = () => { setImg(i); setFit({ x: 50, y: 30, zoom: 100 }); setMsg(""); };
    i.onerror = () => setMsg("Couldn't open that image.");
    i.src = url;
  };

  const save = async () => {
    if (!img) { setMsg("Choose a photo first."); return; }
    setBusy(true); setMsg("");
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    draw(c, img, fit);
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", 0.86));
    if (!blob) { setBusy(false); setMsg("Couldn't prepare the image."); return; }
    const body = new FormData();
    body.append("file", new File([blob], "card.jpg", { type: "image/jpeg" }));
    const res = await fetch(`/api/leagues/${slug}/card-art/${playerId}`, { method: "POST", body }).catch(() => null);
    const j = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res?.ok) { setMsg(j.error || "Couldn't save. Try again."); return; }
    setOpen(false); setImg(null);
    toast("Card art saved");
    router.refresh();
  };

  const remove = async () => {
    setBusy(true);
    await fetch(`/api/leagues/${slug}/card-art/${playerId}`, { method: "DELETE" }).catch(() => null);
    setBusy(false); setOpen(false);
    toast("Card art removed");
    router.refresh();
  };

  if (!open) {
    return <button type="button" className="pcard-flip" onClick={() => setOpen(true)}>{hasArt ? "Change card art" : "Add card art"}</button>;
  }
  return (
    <div className="art-editor">
      <p className="muted small">Only members of this league can see card art.</p>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
      <div className="art-editor-row">
        <div className="art-editor-frame">
          {img ? <canvas ref={canvas} width={W} height={H} /> : <button type="button" className="art-editor-empty" onClick={() => fileRef.current?.click()}>Choose a photo</button>}
        </div>
        {img && (
          <div className="art-editor-controls">
            <label>Left / right<input type="range" min={0} max={100} value={fit.x} onChange={(e) => setFit({ ...fit, x: +e.target.value })} /></label>
            <label>Up / down<input type="range" min={0} max={100} value={fit.y} onChange={(e) => setFit({ ...fit, y: +e.target.value })} /></label>
            <label>Zoom<input type="range" min={100} max={250} value={fit.zoom} onChange={(e) => setFit({ ...fit, zoom: +e.target.value })} /></label>
            <button type="button" className="pcard-flip" onClick={() => fileRef.current?.click()}>Pick a different photo</button>
          </div>
        )}
      </div>
      {msg && <p className="art-editor-err" role="alert">{msg}</p>}
      <div className="art-editor-actions">
        <button type="button" className="btn-primary" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save card art"}</button>
        <button type="button" className="pcard-flip" disabled={busy} onClick={() => { setOpen(false); setImg(null); setMsg(""); }}>Cancel</button>
        {hasArt && <HoldButton disabled={busy} onConfirm={remove}>Hold to remove art</HoldButton>}
      </div>
    </div>
  );
}

/** Cover-fit the image into the canvas, then zoom around the chosen focus point. */
function draw(c: HTMLCanvasElement, img: HTMLImageElement, fit: { x: number; y: number; zoom: number }) {
  const ctx = c.getContext("2d");
  if (!ctx) return;
  const s = Math.max(c.width / img.naturalWidth, c.height / img.naturalHeight) * (fit.zoom / 100);
  const dw = img.naturalWidth * s, dh = img.naturalHeight * s;
  const x = (c.width - dw) * (fit.x / 100), y = (c.height - dh) * (fit.y / 100);
  ctx.fillStyle = "#0a0f18";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, x, y, dw, dh);
}
