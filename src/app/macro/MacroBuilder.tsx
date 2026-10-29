"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFENSE, OFFENSE, findD, findO } from "@/lib/macro/formations";
import { layoutDefense, layoutOffense, personnelText, type Player } from "@/lib/macro/layout";
import { ADJUSTMENTS, applyAdjustments, assignmentsFor, findAssignment, nearestSpot, type Assignment } from "@/lib/macro/macros";
import { DEFAULT_STATE, decodeState, encodeState, type MacroState, type Step } from "@/lib/macro/share";
import { COLORS, FieldChart, H, W } from "./FieldChart";

const DEFAULT_O = { f: "gun", s: "Trips TE" };
const DEFAULT_D = { f: "34", s: "Over Solid" };

function layout(side: "O" | "D", f: string, s: string) {
  return side === "O" ? layoutOffense(f, s) : layoutDefense(f, s);
}
const mirror = (ps: Player[]) => ps.map((p) => ({ ...p, x: 100 - p.x }));

export function MacroBuilder() {
  const [st, setSt] = useState<MacroState>(DEFAULT_STATE);
  const [selected, setSelected] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  // Load a shared macro from the address, then keep the address in sync.
  useEffect(() => {
    const fromHash = decodeState(window.location.hash);
    if (fromHash) setSt(fromHash);
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (!loaded) return;
    const id = setTimeout(() => {
      history.replaceState(null, "", `${location.pathname}#m=${encodeState(st)}`);
    }, 250);
    return () => clearTimeout(id);
  }, [st, loaded]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(id);
  }, [toast]);

  const side = st.side;
  const oppSide = side === "O" ? "D" : "O";
  const cur = side === "O" ? findO(st.f, st.s) : findD(st.f, st.s);
  const opp = st.of ? (oppSide === "O" ? findO(st.of, st.os ?? "") : findD(st.of, st.os ?? "")) : null;

  // Effective step per player, and per team-wide adjustment.
  const playerSteps = useMemo(() => {
    const m = new Map<string, Step>();
    for (const s of st.st) if (s.p !== "*") m.set(s.p, s);
    return m;
  }, [st.st]);
  const adj = useMemo(() => {
    const m: Record<string, string> = {};
    for (const s of st.st) if (s.p === "*" && s.s) m[s.k] = s.s;
    return m;
  }, [st.st]);

  const players = useMemo(() => {
    let ps = layout(side, cur.fam.id, cur.set.name);
    if (st.fl) ps = mirror(ps);
    if (side === "D") ps = applyAdjustments(ps, adj);
    return ps.map((p) => (st.mv[p.id] ? { ...p, x: st.mv[p.id][0], y: st.mv[p.id][1] } : p));
  }, [side, cur.fam.id, cur.set.name, st.fl, st.mv, adj]);
  const oppFam = opp?.fam.id;
  const oppSet = opp?.set.name;
  const ghosts = useMemo(() => (oppFam && oppSet ? layout(oppSide, oppFam, oppSet) : []), [oppFam, oppSet, oppSide]);

  const sel = players.find((p) => p.id === selected) ?? null;
  const selStep = sel ? playerSteps.get(sel.id) : undefined;
  const selAssign = selStep ? findAssignment(side, selStep.k) : undefined;

  const update = useCallback((fn: (s: MacroState) => MacroState) => setSt((s) => fn(s)), []);

  // ---------- formation changes ----------
  function setFormation(f: string, s?: string) {
    const fam = (side === "O" ? OFFENSE : DEFENSE).find((x) => x.id === f)!;
    update((x) => ({ ...x, f, s: s ?? fam.sets[0].name, st: [], mv: {}, fl: undefined }));
    setSelected(null);
  }
  function setOpponent(f: string, s?: string) {
    if (!f) return update((x) => ({ ...x, of: undefined, os: undefined, st: x.st.map((k) => ({ ...k, t: undefined })) }));
    const fam = (oppSide === "O" ? OFFENSE : DEFENSE).find((x) => x.id === f)!;
    update((x) => ({ ...x, of: f, os: s ?? fam.sets[0].name, st: x.st.map((k) => ({ ...k, t: undefined })) }));
  }
  function switchSide(next: "O" | "D") {
    if (next === side) return;
    update((x) => {
      const keepOpp = x.of && x.os ? { f: x.of, s: x.os } : next === "O" ? DEFAULT_O : DEFAULT_D;
      return { ...x, side: next, f: keepOpp.f, s: keepOpp.s, of: x.f, os: x.s, st: [], mv: {}, fl: undefined };
    });
    setSelected(null);
  }

  // ---------- assignments ----------
  function assign(a: Assignment) {
    if (!sel) return;
    const spot = nearestSpot(a, sel);
    let t: string | undefined;
    if (a.kind === "man" && ghosts.length) {
      const taken = new Set([...playerSteps.values()].filter((s) => s.k === "man" && s.p !== sel.id).map((s) => s.t));
      const eligible = ghosts.filter((g) => ["WR", "TE", "RB"].includes(g.group) && !taken.has(g.id));
      t = eligible.sort((u, v) => Math.hypot(u.x - sel.x, (u.y - sel.y) * 2) - Math.hypot(v.x - sel.x, (v.y - sel.y) * 2))[0]?.id;
    }
    const step: Step = { p: sel.id, k: a.key, ...(spot ? { s: spot.id } : {}), ...(t ? { t } : {}) };
    update((x) => ({ ...x, st: [...x.st.filter((s) => s.p !== sel.id), step] }));
  }
  function setSpot(spotId: string) {
    if (!sel) return;
    update((x) => ({ ...x, st: x.st.map((s) => (s.p === sel.id ? { ...s, s: spotId } : s)) }));
  }
  function setTarget(t: string) {
    if (!sel) return;
    update((x) => ({ ...x, st: x.st.map((s) => (s.p === sel.id ? { ...s, t } : s)) }));
  }
  function clearPlayer(id: string) {
    update((x) => ({ ...x, st: x.st.filter((s) => s.p !== id) }));
  }
  function setAdjust(cat: string, key: string) {
    update((x) => {
      const rest = x.st.filter((s) => !(s.p === "*" && s.k === cat));
      return adj[cat] === key ? { ...x, st: rest } : { ...x, st: [...rest, { p: "*", k: cat, s: key }] };
    });
  }
  function removeStep(i: number) {
    update((x) => ({ ...x, st: x.st.filter((_, j) => j !== i) }));
  }

  // ---------- labels ----------
  const labelOf = (id: string) => players.find((p) => p.id === id)?.label ?? id;
  function stepText(s: Step) {
    if (s.p === "*") {
      const a = ADJUSTMENTS.find((x) => x.cat === s.k);
      return `${a?.label ?? s.k}: ${a?.options.find((o) => o.key === s.s)?.label ?? s.s}`;
    }
    const a = findAssignment(side, s.k);
    const spot = a?.spots?.find((x) => x.id === s.s);
    const tgt = s.t ? ghosts.find((g) => g.id === s.t)?.label : undefined;
    let txt = a?.label ?? s.k;
    if (spot && (a?.spots?.length ?? 0) > 1) txt += ` (${spot.label.toLowerCase()})`;
    if (a?.kind === "man") txt = tgt ? `Man on ${tgt}` : "Man";
    return txt;
  }

  const formationName = `${cur.fam.name} ${cur.set.name}`;
  const oppName = opp ? `${opp.fam.name} ${opp.set.name}` : "";
  const chartTitle = st.t?.trim() || formationName;
  const chartSub = st.t?.trim() ? `${formationName}${oppName ? `  vs  ${oppName}` : ""}` : oppName ? `vs ${oppName}` : "";
  const personnel = personnelText(side, cur.set.p);

  // ---------- sharing ----------
  function shareUrl() {
    return `${location.origin}${location.pathname}#m=${encodeState(st)}`;
  }
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(shareUrl());
      setToast("Link copied");
    } catch {
      window.prompt("Copy this link:", shareUrl());
    }
  }
  async function renderPng(): Promise<Blob | null> {
    const svg = svgRef.current;
    if (!svg) return null;
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", String(W * 2));
    clone.setAttribute("height", String(H * 2));
    const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
    style.textContent = CHART_CSS;
    clone.insertBefore(style, clone.firstChild);
    const data = new XMLSerializer().serializeToString(clone);
    const img = new Image();
    const url = URL.createObjectURL(new Blob([data], { type: "image/svg+xml;charset=utf-8" }));
    try {
      await new Promise<void>((res, rej) => {
        img.onload = () => res();
        img.onerror = () => rej(new Error("image"));
        img.src = url;
      });
      const canvas = document.createElement("canvas");
      canvas.width = W * 2;
      canvas.height = H * 2;
      canvas.getContext("2d")!.drawImage(img, 0, 0);
      return await new Promise((res) => canvas.toBlob((b) => res(b), "image/png"));
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  const fileName = `${chartTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "macro"}.png`;
  async function downloadImage() {
    const blob = await renderPng();
    if (!blob) return setToast("Couldn't make the image");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  async function shareNative() {
    const url = shareUrl();
    try {
      const blob = await renderPng();
      const file = blob ? new File([blob], fileName, { type: "image/png" }) : null;
      if (file && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ title: chartTitle, text: `${chartTitle} — open it in Macro Builder: ${url}`, files: [file] });
      } else if (navigator.share) {
        await navigator.share({ title: chartTitle, url });
      } else {
        await copyLink();
      }
    } catch (e) {
      if ((e as Error)?.name !== "AbortError") await copyLink();
    }
  }
  const [canShare, setCanShare] = useState(false);
  const [big, setBig] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 600px)");
    const on = () => setBig(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  useEffect(() => setCanShare(typeof navigator !== "undefined" && !!navigator.share), []);

  // ---------- picker data ----------
  const families = side === "O" ? OFFENSE : DEFENSE;
  const oppFamilies = oppSide === "O" ? OFFENSE : DEFENSE;
  const pickable = players.filter((p) => p.group !== "OL" && !(side === "O" && p.group === "QB"));
  const options = sel ? assignmentsFor(side).filter((a) => a.for.includes(sel.group)) : [];
  const optionGroups = [...new Set(options.map((a) => a.group))];
  const movedCount = Object.keys(st.mv).length;
  const allSets = useMemo(
    () => families.flatMap((f) => f.sets.map((s) => ({ f: f.id, s: s.name, label: `${f.name} ${s.name}` }))),
    [families],
  );
  const [find, setFind] = useState("");

  return (
    <div className="mb">
      <div className="mb-controls panel">
        <div className="mb-row">
          <div className="seg mb-side" role="group" aria-label="Side of the ball">
            <button type="button" aria-pressed={side === "D"} onClick={() => switchSide("D")}>Defense</button>
            <button type="button" aria-pressed={side === "O"} onClick={() => switchSide("O")}>Offense</button>
          </div>
          <label className="mb-find">
            <span className="sr-only">Find a formation</span>
            <input
              type="search"
              list="mb-all-sets"
              placeholder={`Find any of ${allSets.length} ${side === "O" ? "offensive" : "defensive"} sets…`}
              value={find}
              onChange={(e) => {
                const v = e.target.value;
                setFind(v);
                const hit = allSets.find((x) => x.label.toLowerCase() === v.toLowerCase());
                if (hit) {
                  setFormation(hit.f, hit.s);
                  setFind("");
                }
              }}
            />
            <datalist id="mb-all-sets">
              {allSets.map((x) => <option key={x.label} value={x.label} />)}
            </datalist>
          </label>
        </div>
        <div className="mb-row mb-selects">
          <label className="mb-field">
            <span>Formation</span>
            <select value={cur.fam.id} onChange={(e) => setFormation(e.target.value)}>
              {families.map((f) => <option key={f.id} value={f.id}>{f.name} ({f.sets.length})</option>)}
            </select>
          </label>
          <label className="mb-field mb-grow">
            <span>Set</span>
            <select value={cur.set.name} onChange={(e) => setFormation(cur.fam.id, e.target.value)}>
              {cur.fam.sets.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
            </select>
          </label>
          <button
            type="button"
            className="btn btn-quiet mb-flip"
            aria-pressed={!!st.fl}
            onClick={() => update((x) => ({ ...x, fl: x.fl ? undefined : 1, mv: {} }))}
          >
            Flip
          </button>
        </div>
        <div className="mb-row mb-selects mb-opp">
          <label className="mb-field">
            <span>Against {oppSide === "O" ? "offense" : "defense"} (faded)</span>
            <select value={st.of ?? ""} onChange={(e) => setOpponent(e.target.value)}>
              <option value="">None</option>
              {oppFamilies.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </label>
          {opp && (
            <label className="mb-field mb-grow">
              <span>Set</span>
              <select value={opp.set.name} onChange={(e) => setOpponent(opp.fam.id, e.target.value)}>
                {opp.fam.sets.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
              </select>
            </label>
          )}
        </div>
      </div>

      <div className="mb-chart-wrap">
        <FieldChart
          ref={svgRef}
          side={side}
          players={players}
          ghosts={ghosts}
          steps={playerSteps}
          slide={side === "O" ? adj.slide : undefined}
          selected={selected}
          title={chartTitle}
          subtitle={chartSub}
          personnel={personnel}
          onSelect={setSelected}
          big={big}
          onMove={(id, x, y) => update((s) => ({ ...s, mv: { ...s.mv, [id]: [x, y] } }))}
        />
      </div>
      <p className="hint mb-hint">Tap a player to give him an assignment. Drag a player to move his alignment.<span className="mb-rotate"> Turn your phone sideways for a bigger field.</span></p>

      <div className="mb-grid">
        <section className="panel mb-build" aria-labelledby="mb-assign-h">
          <h2 id="mb-assign-h" className="mb-h">Assignments</h2>
          <div className="mb-chips" role="group" aria-label="Pick a player">
            {pickable.map((p) => {
              const has = playerSteps.has(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  className="mb-pchip"
                  aria-pressed={p.id === selected}
                  onClick={() => setSelected(p.id === selected ? null : p.id)}
                  style={{ ["--c" as string]: COLORS[p.group].fill, ["--ci" as string]: COLORS[p.group].ink }}
                >
                  {p.label}
                  {has && <span className="mb-dot" aria-label="has an assignment" />}
                </button>
              );
            })}
          </div>

          {!sel && <p className="muted mb-empty">Pick a player above or on the chart.</p>}
          {sel && (
            <div className="mb-assign">
              <div className="mb-assign-head">
                <strong>{sel.label}</strong>
                <span className="muted">{selAssign ? stepText(selStep!) : "No assignment yet"}</span>
                {selStep && (
                  <button type="button" className="btn-link mb-clear" onClick={() => clearPlayer(sel.id)}>Clear</button>
                )}
              </div>
              {optionGroups.length === 0 && (
                <p className="muted">Quarterbacks and linemen don&apos;t take routes here. Use slide protection below.</p>
              )}
              {optionGroups.map((g) => (
                <div key={g} className="mb-opt-group">
                  <div className="mb-opt-h">{g}</div>
                  <div className="mb-opts">
                    {options.filter((a) => a.group === g).map((a) => (
                      <button
                        key={a.key}
                        type="button"
                        className="mb-opt"
                        aria-pressed={selStep?.k === a.key}
                        style={{ ["--z" as string]: a.kind === "route" ? "var(--ink-soft)" : a.color }}
                        onClick={() => assign(a)}
                      >
                        <span className="mb-swatch" aria-hidden="true" />
                        {a.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              {selAssign?.spots && selAssign.spots.length > 1 && (
                <div className="mb-opt-group">
                  <div className="mb-opt-h">{selAssign.kind === "blitz" ? "Gap" : "Where"}</div>
                  <div className="mb-opts">
                    {selAssign.spots.map((s) => (
                      <button key={s.id} type="button" className="mb-opt small-opt" aria-pressed={selStep?.s === s.id} onClick={() => setSpot(s.id)}>
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {selAssign?.kind === "man" && (
                <div className="mb-opt-group">
                  <div className="mb-opt-h">Covering</div>
                  {ghosts.length ? (
                    <div className="mb-opts">
                      {ghosts.filter((g) => ["WR", "TE", "RB"].includes(g.group)).map((g) => (
                        <button key={g.id} type="button" className="mb-opt small-opt" aria-pressed={selStep?.t === g.id} onClick={() => setTarget(g.id)}>
                          {g.label}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="muted small">Pick an offense to play against (above) to choose who he covers.</p>
                  )}
                </div>
              )}
            </div>
          )}

          <h2 className="mb-h mb-h2">Pre-snap adjustments</h2>
          {ADJUSTMENTS.filter((a) => a.side === side).map((a) => (
            <div key={a.cat} className="mb-opt-group">
              <div className="mb-opt-h">{a.label}</div>
              <div className="mb-opts">
                {a.options.map((o) => (
                  <button key={o.key} type="button" className="mb-opt small-opt" aria-pressed={adj[a.cat] === o.key} onClick={() => setAdjust(a.cat, o.key)}>
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </section>

        <aside className="mb-side-col">
          <section className="panel" aria-labelledby="mb-steps-h">
            <div className="section-head">
              <h2 id="mb-steps-h" className="mb-h">Macro steps</h2>
              {st.st.length > 0 && (
                <button type="button" className="btn-link" onClick={() => update((x) => ({ ...x, st: [] }))}>Clear all</button>
              )}
            </div>
            {st.st.length === 0 ? (
              <p className="muted small">Your steps show up here in the order you set them.</p>
            ) : (
              <ol className="mb-steps">
                {st.st.map((s, i) => (
                  <li key={`${s.p}-${s.k}-${i}`}>
                    <span className="mb-step-who">{s.p === "*" ? "Team" : labelOf(s.p)}</span>
                    <span className="mb-step-what">{stepText(s)}</span>
                    <button type="button" className="mb-x" aria-label={`Remove step ${i + 1}`} onClick={() => removeStep(i)}>×</button>
                  </li>
                ))}
              </ol>
            )}
            {movedCount > 0 && (
              <p className="small muted mb-moved">
                {movedCount} {movedCount === 1 ? "player" : "players"} moved by hand ·{" "}
                <button type="button" className="btn-link" onClick={() => update((x) => ({ ...x, mv: {} }))}>Reset alignment</button>
              </p>
            )}
          </section>

          <section className="panel" aria-labelledby="mb-share-h">
            <h2 id="mb-share-h" className="mb-h">Share</h2>
            <div className="field">
              <label htmlFor="mb-title">Name</label>
              <input id="mb-title" type="text" maxLength={80} placeholder={`e.g. ${side === "D" ? "Cover 3 Sky blitz" : "Trips flood"}`} value={st.t ?? ""} onChange={(e) => update((x) => ({ ...x, t: e.target.value }))} />
            </div>
            <div className="field">
              <label htmlFor="mb-notes">Notes</label>
              <textarea id="mb-notes" maxLength={600} placeholder="When to call it, what it beats, what to watch for" value={st.n ?? ""} onChange={(e) => update((x) => ({ ...x, n: e.target.value }))} />
            </div>
            <div className="mb-share-btns">
              <button type="button" className="btn btn-primary" onClick={canShare ? shareNative : copyLink}>
                {canShare ? "Share" : "Copy link"}
              </button>
              {canShare && <button type="button" className="btn btn-quiet" onClick={copyLink}>Copy link</button>}
              <button type="button" className="btn btn-quiet" onClick={downloadImage}>Download image</button>
            </div>
            <p className="hint">The link opens this exact macro for anyone, no account needed.</p>
          </section>
        </aside>
      </div>

      <div className={`mb-toast${toast ? " show" : ""}`} role="status" aria-live="polite">{toast}</div>
    </div>
  );
}

// Styles baked into the downloaded image (the page's stylesheet doesn't travel with it).
const CHART_CSS = `
  text { font-family: "Barlow Condensed", "Arial Narrow", Arial, sans-serif; }
  .mb-title { font-size: 34px; font-weight: 800; letter-spacing: 2px; fill: #f3f7f4; }
  .mb-subtitle { font-size: 17px; font-weight: 600; letter-spacing: 1px; fill: #b9cbc0; }
  .mb-label { font-weight: 800; }
  .mb-ghost-label { font-weight: 700; fill: #e7efe9; }
  .mb-chip { font-size: 18px; font-weight: 700; fill: #e7efe9; letter-spacing: 0.5px; }
  .mb-credit { font-size: 15px; font-weight: 600; fill: #ffffff; opacity: 0.45; letter-spacing: 1px; }
  .mb-tag { font-size: 16px; font-weight: 800; letter-spacing: 1px; }
`;
