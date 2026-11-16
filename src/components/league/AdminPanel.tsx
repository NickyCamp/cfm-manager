"use client";
// The league admin panel's forms (/l/<slug>/admin). Each one posts to /api/leagues/<slug>/admin.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { TicketsSettingForm } from "@/components/league/markets/TicketsSettingForm";
import { BOT_INVITE_URL } from "@/lib/discord/invite";
import type { BetCaps } from "@/lib/marketStore";
import type { Economy } from "@/lib/league/marketTypes";

export type AdminData = {
  slug: string; tickets: boolean; field: "cash" | "bank"; caps: BetCaps; eco: Economy;
  owed: { userId: string; name: string; net: number; ids: number[]; lines: string[]; discord: string | null }[];
  week: { id: number; name: string; kickoff: string | null; kickoffText: string | null; final: boolean }[];
  finals: { id: number; name: string; kickoffText: string }[];
  discord: { linked: boolean; markets: boolean; games: boolean };
  seasonTitle: string;
  awards: { key: string; title: string; pos: boolean; winner: string | null; choices: { id: string; label: string }[] }[];
  awardsOpen: boolean;    // regular season still being played
};

function useAction(slug: string) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Record<string, { ok: boolean; text: string }>>({});
  const run = async (key: string, body: Record<string, unknown>) => {
    setBusy(key); setMsg((m) => ({ ...m, [key]: { ok: true, text: "Working…" } }));
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(slug)}/admin`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = await res.json().catch(() => ({}));
      setMsg((m) => ({ ...m, [key]: res.ok ? { ok: true, text: j.text || "Done." } : { ok: false, text: j.error || "That didn't work." } }));
      if (res.ok) router.refresh();
    } catch { setMsg((m) => ({ ...m, [key]: { ok: false, text: "Couldn't reach the server." } })); }
    finally { setBusy(null); }
  };
  const note = (key: string) => (msg[key] ? <p className={`mk-msg ${msg[key].ok ? "ok" : "err"}`} role="status">{msg[key].text}</p> : null);
  return { run, busy, note };
}

const pct = (x: number) => String(Math.round(x * 1000) / 10);
const localInput = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso); const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

export function AdminPanel({ data }: { data: AdminData }) {
  const { run, busy, note } = useAction(data.slug);
  const T = data.tickets;
  const money = (n: number) => (T ? `${Math.round(n).toLocaleString("en-US")} Tickets` : `$${n.toLocaleString("en-US")}`);
  const [perBet, setPerBet] = useState(data.caps.perBet == null ? "0" : String(data.caps.perBet));
  const [perUser, setPerUser] = useState(data.caps.perUserWeek == null ? "0" : String(data.caps.perUserWeek));
  const [cut, setCut] = useState(pct(data.eco.cut)), [floor, setFloor] = useState(pct(data.eco.floor)), [fee, setFee] = useState(pct(data.eco.cashoutFee));
  const [kick, setKick] = useState<Record<number, string>>(Object.fromEntries(data.week.map((g) => [g.id, localInput(g.kickoff)])));
  const [vGame, setVGame] = useState(String(data.finals[0]?.id ?? ""));
  const [vAt, setVAt] = useState("");
  const [gcWeek, setGcWeek] = useState("");
  const iso = (local: string) => (local ? new Date(local).toISOString() : "");
  const [aw, setAw] = useState<Record<string, string>>(Object.fromEntries(data.awards.map((a) => [a.key, a.winner ?? ""])));
  const awardRow = (a: AdminData["awards"][number]) => (
    <form key={a.key} className="admin-row" onSubmit={(e) => { e.preventDefault(); run(`aw${a.key}`, { action: "award", market: a.key, winner: aw[a.key] }); }}>
      <strong className="admin-game">{a.title}</strong>
      <select value={aw[a.key] ?? ""} onChange={(e) => setAw((x) => ({ ...x, [a.key]: e.target.value }))} aria-label={`${a.title} winner`}>
        <option value="">{a.winner ? "Clear the winner" : "Not announced yet"}</option>
        {a.choices.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
      </select>
      <button className="btn ghost" disabled={busy === `aw${a.key}` || (aw[a.key] ?? "") === (a.winner ?? "")}>Save</button>
      {a.winner && <span className="muted small">✔ entered</span>}
      {note(`aw${a.key}`)}
    </form>
  );

  return (
    <div className="admin-panel">
      <section className="panel mk-setup">
        <h3>Bet caps <span className="muted small">(/betcap)</span></h3>
        <form className="admin-row" onSubmit={(e) => { e.preventDefault(); run("caps", { action: "betcaps", perBet, perUser }); }}>
          <label>Most one bet can be <input inputMode="numeric" value={perBet} onChange={(e) => setPerBet(e.target.value.replace(/\D/g, ""))} /> {T ? "Tickets" : "$"}</label>
          <label>Most one person can bet per Madden week <input inputMode="numeric" value={perUser} onChange={(e) => setPerUser(e.target.value.replace(/\D/g, ""))} /> {T ? "Tickets" : "$"}</label>
          <p className="hint small">0 = no cap. The weekly total resets when the league advances; cancels and cash-outs give room back.</p>
          <button className="btn" disabled={busy === "caps"}>Save caps</button>
        </form>
        {note("caps")}
      </section>

      <section className="panel mk-setup">
        <h3>House rules <span className="muted small">(/economy)</span></h3>
        <form className="admin-row" onSubmit={(e) => { e.preventDefault(); run("eco", { action: "economy", cut, floor, cashoutFee: fee }); }}>
          <label>House cut of winnings <input inputMode="decimal" value={cut} onChange={(e) => setCut(e.target.value.replace(/[^\d.]/g, ""))} /> % of profit</label>
          <label>Lowest price <input inputMode="decimal" value={floor} onChange={(e) => setFloor(e.target.value.replace(/[^\d.]/g, ""))} /> %{Number(floor) > 0 ? ` (long shots pay at most ${Math.floor(100 / Number(floor))}x)` : ""}</label>
          <label>Futures cash-out fee <input inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value.replace(/[^\d.]/g, ""))} /> %</label>
          <p className="hint small">Always on: nobody can bet on their own game (either team or its props), or against their own team.</p>
          <button className="btn" disabled={busy === "eco"}>Save house rules</button>
        </form>
        {note("eco")}
      </section>

      <section className="panel mk-setup">
        <h3>Currency</h3>
        <TicketsSettingForm slug={data.slug} enabled={T} field={data.field} />
      </section>

      {T && (
        <section className="panel mk-setup">
          <h3>Payouts <span className="muted small">(/payouts)</span></h3>
          <p className="muted small">Results not yet added or removed in UnbelievaBoat. Run the command in Discord, then mark it applied here (or tap Applied on the card in #previous-week-payouts).</p>
          {data.owed.length ? (
            <div className="tbl-wrap"><table className="tbl mk-audit">
              <thead><tr><th scope="col">Member</th><th className="num">Net</th><th scope="col">UnbelievaBoat command</th><th scope="col">What</th><th scope="col"></th></tr></thead>
              <tbody>{data.owed.map((u) => (
                <tr key={u.userId}>
                  <td>{u.name}</td>
                  <td className={`num ${u.net > 0 ? "pos" : u.net < 0 ? "neg" : ""}`}>{u.net > 0 ? "+" : u.net < 0 ? "−" : ""}{Math.abs(u.net).toLocaleString("en-US")}</td>
                  <td>{u.net === 0 ? <span className="muted">nothing to do</span> : u.discord ? <code>{`!${u.net > 0 ? "add" : "remove"}-money ${data.field} <@${u.discord}> ${Math.abs(u.net)}`}</code> : <span className="muted">no Discord linked</span>}</td>
                  <td className="small">{u.lines.slice(0, 4).map((l, i) => <div key={i}>{l}</div>)}{u.lines.length > 4 && <div className="muted">+{u.lines.length - 4} more</div>}</td>
                  <td><button type="button" className="btn ghost" disabled={busy === `a${u.userId}`} onClick={() => run(`a${u.userId}`, { action: "apply", ids: u.ids })}>Mark applied</button>{note(`a${u.userId}`)}</td>
                </tr>
              ))}</tbody>
            </table></div>
          ) : <p className="muted">Nothing waiting: every result has been applied.</p>}
          <div className="admin-row">
            <button type="button" className="btn ghost" disabled={busy === "payouts" || !data.discord.markets} onClick={() => run("payouts", { action: "payouts" })}>Post the payouts report in Discord now</button>
          </div>
          {note("payouts")}
        </section>
      )}

      <section className="panel mk-setup">
        <h3>Madden&apos;s award winners</h3>
        <p className="muted small">EA&apos;s export doesn&apos;t include Madden&apos;s awards, so award markets settle on the winners you enter here ({data.seasonTitle.split(" ")[0]} season). Betting on them closes when the regular season ends{data.awardsOpen ? "" : " (it has)"}. Saving a winner settles the market; bets that already settled on someone else (the old formula, or an earlier pick) are corrected once, {data.tickets ? "into the next payouts report" : "straight into wallets"}. Players are listed most likely first.</p>
        {data.awards.filter((a) => !a.pos).map(awardRow)}
        <details className="mk-how">
          <summary>Position awards ({data.awards.filter((a) => a.pos).length}): {data.awards.filter((a) => a.pos && a.winner).length} entered</summary>
          {data.awards.filter((a) => a.pos).map(awardRow)}
        </details>
      </section>

      <section className="panel mk-setup">
        <h3>Kickoffs this week <span className="muted small">(/kickoff)</span></h3>
        <p className="muted small">Betting on a game and its props closes at its kickoff. As commissioner you can set or change any game&apos;s, even after it has passed. Times are in your time zone.</p>
        {data.week.length ? data.week.map((g) => (
          <form key={g.id} className="admin-row" onSubmit={(e) => { e.preventDefault(); run(`k${g.id}`, { action: "kickoff", gameId: g.id, at: iso(kick[g.id]) }); }}>
            <strong className="admin-game">{g.name}</strong>
            <span className="muted small">{g.final ? "final" : g.kickoffText ? `kickoff ${g.kickoffText}` : "no kickoff set"}</span>
            <input type="datetime-local" value={kick[g.id] ?? ""} onChange={(e) => setKick((k) => ({ ...k, [g.id]: e.target.value }))} aria-label={`Kickoff for ${g.name}`} />
            <button className="btn ghost" disabled={busy === `k${g.id}` || !kick[g.id]}>Save</button>
            {note(`k${g.id}`)}
          </form>
        )) : <p className="muted">No games scheduled this week.</p>}
      </section>

      <section className="panel mk-setup">
        <h3>Verify a kickoff <span className="muted small">(/verifykickoff)</span></h3>
        <p className="muted small">For a finished game: enter when it really kicked off. Every bet and cancel on it placed at or after that time is voided (it stays in the trade log, marked VOID) and the correction goes in the next payouts report.</p>
        <form className="admin-row" onSubmit={(e) => { e.preventDefault(); run("verify", { action: "verify", gameId: Number(vGame), at: iso(vAt) }); }}>
          <select value={vGame} onChange={(e) => setVGame(e.target.value)} aria-label="Game">
            {data.finals.map((g) => <option key={g.id} value={g.id}>{g.name} ({g.kickoffText})</option>)}
          </select>
          <input type="datetime-local" value={vAt} onChange={(e) => setVAt(e.target.value)} aria-label="Real kickoff" />
          <button className="btn" disabled={busy === "verify" || !vGame || !vAt}>Verify and void late bets</button>
        </form>
        {note("verify")}
      </section>

      <section className="panel mk-setup">
        <h3>Discord</h3>
        <div className="admin-row">
          <a className="btn discord-btn" href={BOT_INVITE_URL} target="_blank" rel="noreferrer">{data.discord.linked ? "Add CFM Manager to another server" : "Add CFM Manager to your Discord"}</a>
          <span className="muted small">{data.discord.linked ? "This league is linked to a Discord server." : <>Pick your league&apos;s server, then run <code>/link league:{data.slug}</code> there (needs Manage Server).</>}</span>
        </div>
        {!data.discord.linked ? null : (
          <>
            <div className="admin-row">
              <button type="button" className="btn ghost" disabled={busy === "mu" || !data.discord.markets} onClick={() => run("mu", { action: "marketupdate" })}>Refresh Markets channels (/marketupdate)</button>
              <button type="button" className="btn ghost" disabled={busy === "mc"} onClick={() => { if (confirm("Delete the Markets category and build it again from scratch? #previous-week-payouts is kept.")) run("mc", { action: "marketchannels" }); }}>{data.discord.markets ? "Rebuild" : "Create"} Markets channels (/marketchannels)</button>
            </div>
            {note("mu")}{note("mc")}
            <form className="admin-row" onSubmit={(e) => { e.preventDefault(); run("gc", { action: "gamechannels", week: gcWeek }); }}>
              <label>Game channels for week <input inputMode="numeric" placeholder="this week" value={gcWeek} onChange={(e) => setGcWeek(e.target.value.replace(/\D/g, ""))} /></label>
              <button className="btn ghost" disabled={busy === "gc"}>Build (/gamechannels)</button>
              {data.discord.games && <button type="button" className="btn ghost" disabled={busy === "gc"} onClick={() => { if (confirm("Delete the game channels category?")) run("gc", { action: "gamechannels", remove: true }); }}>Remove</button>}
            </form>
            <p className="hint small">Weeks 1–18; 19 Wild Card, 20 Divisional, 21 Conference, 22 Super Bowl. These can take a minute or two.</p>
            {note("gc")}
          </>
        )}
      </section>
      <p className="muted small">{data.seasonTitle}{T ? ` · Tickets in members' UnbelievaBoat ${data.field} balance` : " · play money"} · per bet {data.caps.perBet == null ? "no cap" : money(data.caps.perBet)}</p>
    </div>
  );
}
