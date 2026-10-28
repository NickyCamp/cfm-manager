"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ConnectResult } from "@/app/api/ea/connect/route";
import { slugify } from "@/lib/slug";

type League = ConnectResult["leagues"][number];

export function ConnectWizard({ eaSignInUrl }: { eaSignInUrl: string }) {
  const router = useRouter();
  const [opened, setOpened] = useState(false);
  const [pasted, setPasted] = useState("");
  const [finding, setFinding] = useState(false);
  const [leagues, setLeagues] = useState<League[] | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [pick, setPick] = useState<string>("");
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const picked = useMemo(() => leagues?.find((l) => keyOf(l) === pick), [leagues, pick]);
  const looksRight = /127\.0\.0\.1\/success\?.*code=/.test(pasted) || /^[A-Za-z0-9._-]{20,}$/.test(pasted.trim());

  async function findLeagues(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setFinding(true);
    try {
      const res = await fetch("/api/ea/connect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: pasted }) });
      const j = await res.json();
      if (!res.ok) { setError(j.error || "That didn't work. Sign in to EA again and paste the new address."); return; }
      setLeagues(j.leagues);
      setWarnings(j.warnings || []);
      if (j.leagues.length === 1) choose(j.leagues[0]);
    } catch {
      setError("Couldn't reach CFM Manager. Check your connection and try again.");
    } finally {
      setFinding(false);
    }
  }

  function choose(l: League) {
    setPick(keyOf(l));
    setName(l.leagueName);
    if (!slugTouched) setSlug(slugify(l.leagueName));
  }

  async function addLeague(e: React.FormEvent) {
    e.preventDefault();
    if (!picked) return;
    setError("");
    setSaving(true);
    try {
      const res = await fetch("/api/leagues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionId: picked.connectionId, eaLeagueId: picked.eaLeagueId, name, slug }),
      });
      const j = await res.json();
      if (!res.ok) { setError(j.error || "Couldn't add the league."); return; }
      router.push(`/l/${j.slug}${j.joined ? "?joined=1" : "?new=1"}`);
    } catch {
      setError("Couldn't reach CFM Manager. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  const step2Active = opened || pasted.length > 0;
  const step3Active = leagues !== null;

  return (
    <div className="panel">
      {error && <div className="notice error" role="alert">{error}</div>}

      <section className={`wizard-step ${step2Active ? "done" : ""}`}>
        <div className="n" aria-hidden>1</div>
        <div>
          <h3>Sign in to EA</h3>
          <p>EA&apos;s sign-in page opens in a new tab. After you sign in, that tab lands on a page that won&apos;t load. That&apos;s expected: its address holds a one-time code.</p>
          <a className="btn btn-primary" href={eaSignInUrl} target="_blank" rel="noopener noreferrer" onClick={() => setOpened(true)}>
            Open EA sign-in
          </a>
        </div>
      </section>

      <section className={`wizard-step ${step3Active ? "done" : ""} ${step2Active ? "" : "inactive"}`}>
        <div className="n" aria-hidden>2</div>
        <form onSubmit={findLeagues}>
          <h3>Paste the address</h3>
          <div className="field">
            <label htmlFor="ea-addr">Address from the page that wouldn&apos;t load</label>
            <textarea id="ea-addr" value={pasted} onChange={(e) => setPasted(e.target.value)}
              placeholder="http://127.0.0.1/success?code=…" spellCheck={false} autoCapitalize="off" autoCorrect="off" />
            <div className="hint">On a phone, tap the address bar, then Copy. The code works once and expires after a few minutes.</div>
          </div>
          <button className="btn btn-primary" type="submit" disabled={!looksRight || finding}>
            {finding ? "Finding your leagues…" : "Find my leagues"}
          </button>
        </form>
      </section>

      <section className={`wizard-step ${step3Active ? "" : "inactive"}`}>
        <div className="n" aria-hidden>3</div>
        <div>
          <h3>Pick your league</h3>
          {warnings.map((w) => <div className="notice" key={w}>{w}</div>)}
          {leagues === null ? (
            <p className="hint">Your franchise leagues show up here.</p>
          ) : leagues.length === 0 ? (
            <div className="notice">No Connected Franchise leagues were found on this EA account. Join the league in Madden first, then sign in to EA again.</div>
          ) : (
            <form onSubmit={addLeague}>
              <fieldset style={{ border: 0, padding: 0, margin: "0 0 16px" }}>
                <legend className="sr-only">League</legend>
                {leagues.map((l) => (
                  <label className="choice" key={keyOf(l)}>
                    <input type="radio" name="league" checked={pick === keyOf(l)} onChange={() => choose(l)} />
                    <span>
                      <span className="name">{l.leagueName}</span><br />
                      <span className="meta">
                        {l.consoleLabel}, signed in as {l.personaName}
                        {l.userTeamName ? `, you're the ${l.userTeamName}` : ""}
                        {l.existingSlug ? ". Already on CFM Manager; you'll join it." : ""}
                      </span>
                    </span>
                  </label>
                ))}
              </fieldset>

              {picked && !picked.existingSlug && (
                <>
                  <div className="field">
                    <label htmlFor="lg-name">League name</label>
                    <input id="lg-name" type="text" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
                  </div>
                  <div className="field">
                    <label htmlFor="lg-slug">Web address</label>
                    <div className="addr">
                      <span>/l/</span>
                      <input id="lg-slug" type="text" value={slug} maxLength={40} spellCheck={false} autoCapitalize="off"
                        onChange={(e) => { setSlugTouched(true); setSlug(slugify(e.target.value) || e.target.value.toLowerCase()); }} />
                    </div>
                    <div className="hint">Lowercase letters, numbers and dashes. This is the link you&apos;ll share.</div>
                  </div>
                </>
              )}
              <button className="btn btn-primary" type="submit" disabled={!picked || saving}>
                {saving ? "Adding…" : picked?.existingSlug ? "Join league" : "Add league"}
              </button>
            </form>
          )}
        </div>
      </section>
    </div>
  );
}

function keyOf(l: League) { return `${l.console}:${l.eaLeagueId}`; }
