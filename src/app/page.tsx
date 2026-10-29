import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser, supabaseConfigured } from "@/lib/supabase/server";

const PAGES = [
  ["Cap & contracts", "Every team's cap room, each player's deal year by year, dead money, and a calculator for offers before you make them."],
  ["Standings & playoffs", "Division races and the playoff picture with real NFL tiebreakers."],
  ["Scores & box scores", "Every game, played or simmed, with leaders and full team stats."],
  ["Transactions", "Trades, signings, extensions and releases in the order they happened."],
  ["Draft order", "Updated after every advance, tiebreakers included."],
  ["Player pages", "Contracts, ratings over time, abilities and a game log."],
];

export default async function Home() {
  if (supabaseConfigured() && (await currentUser())) redirect("/dashboard");

  return (
    <main>
      <section className="hero">
        <div className="wrap hero-grid">
          <div>
            <h1>Your Madden franchise league, on every phone in the league.</h1>
            <p>
              Sign in with your EA account, pick your Connected Franchise league, and CFM Manager builds its site:
              cap space, contracts, standings, scores and transactions, refreshed from EA after every advance.
            </p>
            <div className="hero-actions">
              <Link className="btn btn-primary" href="/login?next=/connect">Set up your league</Link>
              <Link className="btn btn-quiet" href="/login">Sign in</Link>
            </div>
          </div>
          <figure className="capsheet" aria-label="Example: a team's cap sheet">
            <h3>Packers cap sheet</h3>
            <div className="sub">2027 regular season, week 11</div>
            <table>
              <tbody>
                <tr><td>Jordan Love, QB</td><td className="num">$55.4M</td></tr>
                <tr><td>Rashan Gary, EDGE</td><td className="num">$28.1M</td></tr>
                <tr><td>Xavier McKinney, S</td><td className="num">$16.9M</td></tr>
                <tr><td>Tucker Kraft, TE</td><td className="num">$12.3M</td></tr>
                <tr><td>Dead money</td><td className="num">$6.2M</td></tr>
              </tbody>
            </table>
            <div className="meter" role="img" aria-label="88% of the cap used"><span /></div>
            <div className="room"><span>$287.4M spent</span><span>$38.6M room</span></div>
          </figure>
        </div>
      </section>

      <section className="section mb-promo">
        <div className="wrap mb-promo-row">
          <div>
            <h2>Macro Builder</h2>
            <p>
              Pick any Madden 27 formation, offense or defense, and draw your macro on it: zones, blitzes, man
              matchups, hot routes and pre-snap adjustments. Send the link to your friends. No account needed.
            </p>
          </div>
          <Link className="btn btn-primary" href="/macro">Open Macro Builder</Link>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <h2>Running in about five minutes</h2>
          <ol className="steps">
            <li>
              <h3>Create an account</h3>
              <p>An email and a password. That&apos;s it.</p>
            </li>
            <li>
              <h3>Connect EA</h3>
              <p>Sign in on EA&apos;s own page, then paste back the address it sends you to.</p>
            </li>
            <li>
              <h3>Pick your league</h3>
              <p>Choose it from your franchise list and share the link with your league.</p>
            </li>
          </ol>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <h2>What your league gets</h2>
          <ul className="pages-list">
            {PAGES.map(([t, d]) => (
              <li key={t}><strong>{t}</strong><span>{d}</span></li>
            ))}
          </ul>
        </div>
      </section>

      <footer className="site-foot">
        <div className="wrap">
          CFM Manager is a fan project. It isn&apos;t affiliated with or endorsed by EA, the NFL or the NFLPA.
        </div>
      </footer>
    </main>
  );
}
