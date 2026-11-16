// "How this works" on the Markets page (Nick, 2026-11-14). Uses the league's own settings
// (currency, caps, house rules), so the numbers are always the ones in force.
import Link from "next/link";
import type { SharedState } from "@/lib/marketStore";
import { DEFAULT_ECONOMY, MAX_BET_DOLLARS, MAX_BET_TICKETS } from "@/lib/league/marketTypes";

export function HowItWorks({ slug, shared }: { slug: string; shared: SharedState | null }) {
  const T = shared?.currency === "tickets";
  const eco = shared?.economy ?? DEFAULT_ECONOMY;
  const perBet = shared?.caps ? shared.caps.perBet : T ? MAX_BET_TICKETS : MAX_BET_DOLLARS;
  const perWeek = shared?.caps?.perUserWeek ?? null;
  const money = (n: number) => (T ? `${n.toLocaleString("en-US")} Tickets` : `$${n.toLocaleString("en-US")}`);
  const pays = T ? "100 Tickets" : "$1";
  const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;
  const ex = { stake: T ? 4000 : 40, price: 0.4 };
  const exQty = Math.floor(ex.stake / (ex.price * (T ? 100 : 1)));
  const exPays = exQty * (T ? 100 : 1);
  const exKeep = Math.round(exPays - (exPays - ex.stake) * eco.cut);

  return (
    <details className="panel mk-how">
      <summary><strong>How this works</strong> <span className="muted small">prices, payouts, cancelling, and the house rules</span></summary>
      <div className="mk-how-body">
        <section>
          <h4>Prices are chances</h4>
          <p>Every bet is a yes/no question: will the Chiefs win the Super Bowl? Will this QB throw for 300 yards? The price is the chance it happens. <strong>40%</strong> means it happens about 4 times in 10.</p>
          <p>Prices start from a simulation of the rest of the season, run again after every sync{shared ? <>, and then move with what members bet: buying Yes pushes the price up, so getting in early gets you a better price</> : null}.</p>
        </section>
        <section>
          <h4>What a bet buys</h4>
          <p>A bet buys <strong>contracts</strong>. Each one pays <strong>{pays}</strong> if you&apos;re right and nothing if you&apos;re wrong. The lower the price, the more contracts your money buys.</p>
          <p className="mk-how-ex">Example: {money(ex.stake)} on a 40% chance buys about {exQty.toLocaleString("en-US")} contracts. If it hits they pay {money(exPays)}{eco.cut > 0 ? <>, and you keep {money(exKeep)} after the house cut</> : null}. If it misses, you lose the {money(ex.stake)}.</p>
          <ul>
            <li>Your payout is <strong>locked in when you bet</strong>. Later bets move the price for everyone else, but not what your contracts pay.</li>
            <li>A big bet moves the price as it fills, so you pay the average price across that move. Your bet slip shows it before you confirm.</li>
            <li>Bets buy whole contracts, so a few {T ? "Tickets" : "cents"} of what you enter may not be used. You&apos;re only charged for what you get.</li>
          </ul>
        </section>
        <section>
          <h4>Changing your mind</h4>
          <ul>
            <li><strong>Game and player-prop bets</strong> can be cancelled until kickoff. You get back what you paid, or what the bet is worth then if the price has dropped.</li>
            <li><strong>Season-long bets</strong> (Super Bowl, divisions, awards, playoffs, win totals) can&apos;t be cancelled. You can <strong>cash out</strong> any time before they settle at what they&apos;re worth then: more than you paid if the odds moved your way, less if not{eco.cashoutFee > 0 ? <>, less a {pct(eco.cashoutFee)} cash-out fee</> : null}.</li>
            <li>You can&apos;t hold both sides of the same bet. Cancel one first.</li>
          </ul>
        </section>
        <section>
          <h4>When betting closes and how it settles</h4>
          <ul>
            <li>A game and its props close at the <strong>kickoff time</strong> its managers set (<code>/kickoff</code> in Discord, or on the game&apos;s market page), or as soon as EA reports the game played.</li>
            <li>Bets settle on the final score and box score after the next sync. A tied game is void and every stake comes back.</li>
            <li>Season-long bets settle when the season decides them: the regular season&apos;s end for divisions and win totals, the Super Bowl for the champion.</li>
            <li><strong>Awards</strong> follow Madden&apos;s own: MVP and Coach of the Year for the whole league; OPOY, DPOY, OROY, DROY and a Player of the Year for every position (offensive line together, defensive line together, linebackers together, safeties together, no FB or LS) in each conference. Betting on them closes when the regular season ends, and they settle on Madden&apos;s winners once a commissioner enters them (EA&apos;s export doesn&apos;t include awards).</li>
            <li>If a kickoff turns out to have been set too late, an admin can verify the real one. Any bet placed after it is voided.</li>
          </ul>
        </section>
        {T && (
          <section>
            <h4>Tickets</h4>
            <ul>
              <li>Bets are in the league&apos;s real Tickets. Your stake leaves your UnbelievaBoat balance as soon as you bet, and cancels and cash-outs go straight back.</li>
              <li>Winnings are added by admins after each advance, from the <strong>#previous-week-payouts</strong> report in Discord. Your balance here already counts them, so you can keep betting with them before they land in UnbelievaBoat.</li>
              <li>Link your Discord once with <code>/connect</code> so your bets and balance are yours on both the site and Discord.</li>
            </ul>
          </section>
        )}
        <section>
          <h4>House rules</h4>
          <ul>
            <li><strong>Fair play:</strong> you can&apos;t bet on your own game (either team or any of its player props), or against your own team anywhere. Backing your own team in season-long bets is fine.</li>
            <li><strong>Limits:</strong> {perBet != null ? <>at most {money(perBet)} per bet</> : "no per-bet limit"}{perWeek != null ? <>, and at most {money(perWeek)} per person per Madden week (cancels and cash-outs give room back)</> : null}.</li>
            {eco.cut > 0 && <li><strong>House cut:</strong> {pct(eco.cut)} of a winning bet&apos;s profit.</li>}
            {eco.floor > 0 && <li><strong>Long shots:</strong> nothing sells for less than {pct(eco.floor)}, so a bet pays at most {Math.floor(1 / eco.floor)}x.</li>}
          </ul>
        </section>
        <section>
          <h4>Betting from Discord</h4>
          <p>In the league&apos;s Discord, every game has its own channel with a Yes/No button on each line, and <strong>#futures</strong> has the season-long bets. Tap one to see the live price privately and pick an amount. <strong>🎟️ My bets</strong> (or <code>/bets</code>) lists your open bets with Cancel or Cash out buttons. <code>/balance</code> shows what you can bet.</p>
        </section>
        <p className="muted small">Everything is public: every bet, cancel, payout and kickoff change is in the <Link href={`/l/${slug}/markets/activity`}>trade log</Link>, which nobody can edit.</p>
      </div>
    </details>
  );
}
