"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFENSE, OFFENSE, findD, findO } from "@/lib/macro/formations";
import { layoutDefense, layoutOffense, personnelText, type Player } from "@/lib/macro/layout";
import {
  applyAdjustments,
  defCtx,
  defOptionsFor,
  findCat,
  findDefOption,
  findOffOption,
  offOptionsFor,
  roleOf,
  ROLE_NAME,
  sectionsFor,
  settingsLines,
} from "@/lib/macro/macros";
import { DEFAULT_STATE, decodeState, encodeState, type MacroState, type Step } from "@/lib/macro/share";
import { CHECK_INFO, familyFromShell, MATCH_FAMILIES, planMatch, type MatchFamily } from "@/lib/macro/match";
import { chartHeight, COLORS, FieldChart, W } from "./FieldChart";

const DEFAULT_O = { f: "gun", s: "Trips TE" };
const DEFAULT_D = { f: "3-4", s: "Over Solid" };

function layout(side: "O" | "D", f: string, s: string) {
  return side === "O" ? layoutOffense(f, s) : layoutDefense(f, s);
}
const mirror = (ps: Player[]) => ps.map((p) => ({ ...p, x: 100 - p.x }));

/** Drops steps from older links whose option no longer exists. */
function stepKnown(side: "O" | "D", s: Step) {
  if (s.p === "*") return !!findCat(side, s.k)?.options.some((o) => o.key === s.s);
  return !!(side === "D" ? findDefOption(s.k) : findOffOption(s.k));
}

export function MacroBuilder() {
  const [st, setSt] = useState<MacroState>(DEFAULT_STATE);
  const [selected, setSelected] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  // Desktop side panel: open/closed and which tab is showing.
  const [panelOpen, setPanelOpen] = useState(true);
  const [tab, setTab] = useState<"adjust" | "steps" | "share">("adjust");
  const panelScroll = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  // Load a shared macro from the address, then keep the address in sync.
  useEffect(() => {
    const fromHash = decodeState(window.location.hash);
    if (fromHash) setSt({ ...fromHash, st: fromHash.st.filter((x) => stepKnown(fromHash.side, x)) });
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

  const oppFam = opp?.fam.id;
  const oppSet = opp?.set.name;
  const ghosts = useMemo(() => (oppFam && oppSet ? layout(oppSide, oppFam, oppSet) : []), [oppFam, oppSet, oppSide]);
  // Offensive strength (the side with more receivers) decides "Strong", "Weak" and "3 Rec Hook".
  const strong: 1 | -1 = useMemo(() => {
    if (side !== "D" || !ghosts.length) return 1;
    const rec = ghosts.filter((g) => g.group === "WR" || g.group === "TE");
    return rec.filter((g) => g.x < 50).length > rec.filter((g) => g.x > 50).length ? -1 : 1;
  }, [side, ghosts]);
  const ctx = useMemo(() => defCtx(adj, strong), [adj, strong]);
  const matchFamily = (st.mp as MatchFamily | undefined) ?? familyFromShell(adj.sh);

  const players = useMemo(() => {
    let ps = layout(side, cur.fam.id, cur.set.name);
    if (st.fl) ps = mirror(ps);
    if (side === "D") ps = applyAdjustments(ps, adj, strong);
    return ps.map((p) => (st.mv[p.id] ? { ...p, x: st.mv[p.id][0], y: st.mv[p.id][1] } : p));
  }, [side, cur.fam.id, cur.set.name, st.fl, st.mv, adj, strong]);

  const matchPlan = useMemo(
    () => (side === "D" && st.mo ? planMatch(matchFamily, adj, players, ghosts) : null),
    [side, st.mo, matchFamily, adj, players, ghosts],
  );
  const caption = useMemo(() => {
    const lines = settingsLines(side, adj);
    if (!matchPlan) return lines;
    const label = (id: string) => players.find((p) => p.id === id)?.label ?? id;
    return [...lines, ...matchPlan.notes, ...matchPlan.lines.map((l) => ({ label: label(l.from), value: l.tag }))];
  }, [side, adj, matchPlan, players]);

  const sel = players.find((p) => p.id === selected) ?? null;
  const selStep = sel ? playerSteps.get(sel.id) : undefined;

  const update = useCallback((fn: (s: MacroState) => MacroState) => setSt((s) => fn(s)), []);

  const selectPlayer = useCallback((id: string | null) => {
    setSelected(id);
    if (!id) return;
    setPanelOpen(true);
    setTab("adjust");
    panelScroll.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  // ---------- formation changes ----------
  function setFormation(f: string, s?: string) {
    const fam = (side === "O" ? OFFENSE : DEFENSE).find((x) => x.id === f)!;
    update((x) => ({ ...x, f, s: s ?? fam.sets[0].name, st: [], mv: {}, fl: undefined }));
    setSelected(null);
  }
  function setOpponent(f: string, s?: string) {
    if (!f) return update((x) => ({ ...x, of: undefined, os: undefined }));
    const fam = (oppSide === "O" ? OFFENSE : DEFENSE).find((x) => x.id === f)!;
    update((x) => ({ ...x, of: f, os: s ?? fam.sets[0].name }));
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
  function assign(key: string) {
    if (!sel) return;
    if (selStep?.k === key) return clearPlayer(sel.id);
    update((x) => ({ ...x, st: [...x.st.filter((s) => s.p !== sel.id), { p: sel.id, k: key }] }));
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
      const c = findCat(side, s.k);
      return `${c?.label ?? s.k}: ${c?.options.find((o) => o.key === s.s)?.label ?? s.s}`;
    }
    return (side === "D" ? findDefOption(s.k)?.label : findOffOption(s.k)?.label) ?? s.k;
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
    const H = chartHeight(caption.length);
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
  const pickable = side === "D" ? players.filter((p) => roleOf(p)) : players.filter((p) => p.group !== "OL" && p.group !== "QB");
  const selRole = sel && side === "D" ? roleOf(sel) : null;
  const defOpts = sel && side === "D" ? defOptionsFor(sel) : [];
  const offOpts = sel && side === "O" ? offOptionsFor(sel) : [];
  const offGroups = [...new Set(offOpts.map((a) => a.group))];
  const sections = sectionsFor(side);
  const movedCount = Object.keys(st.mv).length;
  const allSets = useMemo(
    () => families.flatMap((f) => f.sets.map((s) => ({ f: f.id, s: s.name, label: `${f.name} ${s.name}` }))),
    [families],
  );
  const [find, setFind] = useState("");

  return (
    <div className={`mb mb-layout${panelOpen ? "" : " is-closed"}`}>
      <div className="mb-stage">
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
        {side === "D" && (
          <div className="mb-row mb-match-row">
            <button
              type="button"
              className="mb-toggle"
              aria-pressed={!!st.mo}
              onClick={() => update((x) => ({ ...x, mo: x.mo ? undefined : 1, of: x.of ?? "gun", os: x.of ? x.os : "Trips TE" }))}
            >
              <span className="mb-toggle-box" aria-hidden="true" />
              Match preview
            </button>
            <label className="mb-field mb-grow">
              <span className="sr-only">Coverage to preview</span>
              <select value={matchFamily} disabled={!st.mo} onChange={(e) => update((x) => ({ ...x, mp: e.target.value }))}>
                {MATCH_FAMILIES.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
              </select>
            </label>
          </div>
        )}
      </div>

      <div className="mb-stage-bar">
        <button type="button" className="btn-link mb-panel-toggle" aria-expanded={panelOpen} aria-controls="mb-panel" onClick={() => setPanelOpen((o) => !o)}>
          {panelOpen ? "Hide options ›" : "‹ Show options"}
        </button>
      </div>
      <div className="mb-chart-wrap" style={{ ["--h" as string]: chartHeight(caption.length) }}>
        <FieldChart
          ref={svgRef}
          side={side}
          players={players}
          ghosts={ghosts}
          steps={playerSteps}
          adj={adj}
          ctx={ctx}
          caption={caption}
          match={matchPlan}
          selected={selected}
          title={chartTitle}
          subtitle={chartSub}
          personnel={personnel}
          onSelect={selectPlayer}
          big={big}
          onMove={(id, x, y) => update((s) => ({ ...s, mv: { ...s.mv, [id]: [x, y] } }))}
        />
      </div>
      <p className="hint mb-hint">Tap a player to give him an assignment. Drag a player to move his alignment.<span className="mb-rotate"> Turn your phone sideways for a bigger field.</span></p>
      </div>

      <div className="mb-panel" id="mb-panel">
        <div className="mb-panel-inner">
        <div className="mb-tabs" role="tablist" aria-label="Macro options">
          {([["adjust", "Adjust"], ["steps", `Steps${st.st.length ? ` (${st.st.length})` : ""}`], ["share", "Share"]] as const).map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>
          ))}
        </div>
        <div className="mb-panel-scroll" ref={panelScroll}>
        <section className={`panel mb-build mb-pane${tab === "adjust" ? " is-active" : ""}`} aria-labelledby="mb-assign-h">
          <h2 id="mb-assign-h" className="mb-h">{side === "D" ? "Individual adjustments" : "Hot routes"}</h2>
          <div className="mb-chips" role="group" aria-label="Pick a player">
            {pickable.map((p) => {
              const has = playerSteps.has(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  className="mb-pchip"
                  aria-pressed={p.id === selected}
                  onClick={() => selectPlayer(p.id === selected ? null : p.id)}
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
                <span className="muted">{selStep ? stepText(selStep) : selRole ? ROLE_NAME[selRole] : "No assignment yet"}</span>
                {selStep && (
                  <button type="button" className="btn-link mb-clear" onClick={() => clearPlayer(sel.id)}>Clear</button>
                )}
              </div>
              {side === "D" && (
                <div className="mb-opts mb-opts-8">
                  {defOpts.map((o) => (
                    <button
                      key={o.key}
                      type="button"
                      className="mb-opt"
                      aria-pressed={selStep?.k === o.key}
                      style={{ ["--z" as string]: o.color }}
                      onClick={() => assign(o.key)}
                    >
                      <span className="mb-swatch" aria-hidden="true" />
                      {o.label}
                    </button>
                  ))}
                </div>
              )}
              {side === "O" && offGroups.map((g) => (
                <div key={g} className="mb-opt-group">
                  <div className="mb-opt-h">{g}</div>
                  <div className="mb-opts">
                    {offOpts.filter((a) => a.group === g).map((a) => (
                      <button key={a.key} type="button" className="mb-opt" aria-pressed={selStep?.k === a.key} style={{ ["--z" as string]: "var(--ink-soft)" }} onClick={() => assign(a.key)}>
                        <span className="mb-swatch" aria-hidden="true" />
                        {a.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          <h2 className="mb-h mb-h2">{side === "D" ? "Team adjustments" : "Protection"}</h2>
          {side === "D" && <p className="muted small mb-sec-note">Same settings and order as the game&apos;s Create Adjustment screen. Tap an option again to clear it.</p>}
          <div className="mb-sections">
            {sections.map((sec, i) => {
              const setCount = sec.cats.filter((k) => adj[k.cat]).length;
              return (
                <details key={sec.title} className="mb-sec" open={i === 0 || setCount > 0 || sections.length === 1}>
                  <summary>
                    <span>{sec.title}</span>
                    {setCount > 0 && <span className="mb-sec-count">{setCount} set</span>}
                  </summary>
                  {sec.cats.map((k) => (
                    <div key={k.cat} className="mb-opt-group">
                      <div className="mb-opt-h">{k.label}</div>
                      <div className="mb-opts">
                        {k.options.map((o) => (
                          <button key={o.key} type="button" className="mb-opt small-opt" aria-pressed={adj[k.cat] === o.key} onClick={() => setAdjust(k.cat, o.key)}>
                            {o.label}
                          </button>
                        ))}
                      </div>
                      {CHECK_INFO[k.cat] && adj[k.cat] && CHECK_INFO[k.cat][adj[k.cat]] && (
                        <p className="mb-check-info">{CHECK_INFO[k.cat][adj[k.cat]]}</p>
                      )}
                    </div>
                  ))}
                </details>
              );
            })}
          </div>
        </section>

          <section className={`panel mb-pane${tab === "steps" ? " is-active" : ""}`} aria-labelledby="mb-steps-h">
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

          <section className={`panel mb-pane${tab === "share" ? " is-active" : ""}`} aria-labelledby="mb-share-h">
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
        </div>
        </div>
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
  .mb-cap-h { font-size: 16px; font-weight: 800; letter-spacing: 2px; fill: #f2c200; }
  .mb-cap { font-size: 17px; }
  .mb-cap-k { font-weight: 600; fill: #9fb5a8; }
  .mb-cap-v { font-weight: 800; fill: #f3f7f4; }
  .mb-rec-n { font-weight: 800; fill: #1d1700; }
  .mb-match-tag { font-weight: 700; }
`;
