import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { leagueBySlug, discordOf } from "@/lib/discord/links";
import { isCommissioner, marketsShared, viewer } from "@/lib/marketStore";
import { discordOfUser, ticketBalance, ticketsConfig, UB_AUTHORIZE_URL, type TicketsSetting } from "@/lib/tickets";
import { TicketsSettingForm } from "@/components/league/markets/TicketsSettingForm";

export const metadata: Metadata = { title: "Setup guide · Markets" };
type Props = { params: Promise<{ slug: string }> };

// How any league runs the Markets in its own Discord (Nick, 2026-11-14: "standardize this with
// instructions on the markets tab somewhere out of the way incase any other leagues want to try it").
// Linked quietly from the bottom of the Markets page. Shows this league's progress through the steps.
const BOT_INVITE = "https://discord.com/oauth2/authorize?client_id=1570587209743073343&scope=bot+applications.commands&permissions=52240";

export default async function MarketsSetup({ params }: Props) {
  const { slug } = await params;
  const lg = await leagueBySlug(slug);
  const [v, shared, cfg] = await Promise.all([viewer(slug), marketsShared(), ticketsConfig(slug).catch(() => null)]);
  const commish = Boolean(v.leagueId && v.userId && (await isCommissioner(v.leagueId, v.userId).catch(() => false)));
  const guild = lg ? discordOf(lg) : null;
  const mc = lg?.settings?.marketChannels as { categoryId?: string; payouts?: { reportKey?: string } } | undefined;
  const own = (lg?.settings?.tickets || null) as TicketsSetting | null;
  const me = v.userId ? await discordOfUser(v.userId).catch(() => null) : null;
  let ub: "ok" | "no" | "unknown" = "unknown";
  if (cfg && me) { try { await ticketBalance(cfg, me.id); ub = "ok"; } catch { ub = "no"; } }

  const step = (done: boolean | null, text: ReactNode) => (
    <li className={done ? "done" : undefined}><span aria-hidden>{done ? "✓" : done === null ? "–" : "○"}</span> {text}</li>
  );

  return (
    <main className="page league-page markets-page">
      <div className="wrap">
        <nav className="mk-crumbs" aria-label="Breadcrumb"><Link href={`/l/${slug}/markets`}>Markets</Link><span aria-hidden> / </span>Setup guide</nav>
        <h2>Running the Markets in your league&apos;s Discord</h2>
        <p className="muted">Any league on CFM Manager can use the Markets on the site as they are, with play money. These steps add the Discord side: a channel per game with bet buttons, and, if your server uses UnbelievaBoat, betting its currency with weekly payout reports for your admins.</p>

        <div className="panel mk-setup">
          <h3>This league so far</h3>
          <ul className="mk-checklist">
            {step(shared, "Shared betting is switched on for the site")}
            {step(Boolean(guild), guild ? "A Discord server is linked (/link)" : "No Discord server linked yet (step 2)")}
            {step(Boolean(mc?.categoryId), mc?.categoryId ? "Markets channels are set up (/marketchannels)" : "Markets channels not set up yet (step 3)")}
            {step(cfg ? true : null, cfg ? `Betting UnbelievaBoat Tickets (members' ${cfg.field} balance)` : "Betting play money (UnbelievaBoat is optional, step 5)")}
            {cfg && step(ub === "ok" ? true : ub === "no" ? false : null, ub === "ok" ? "UnbelievaBoat lets CFM Manager read balances in your server" : ub === "no" ? "UnbelievaBoat refused to share balances: a server Administrator needs to do step 5a" : "Link your Discord (/connect) to check UnbelievaBoat access")}
            {v.userId ? step(Boolean(me), me ? `Your Discord is linked (${me.name || "linked"})` : "Your Discord isn't linked yet (step 4)") : step(null, "Sign in to see your own steps")}
            {cfg && step(Boolean(mc?.payouts?.reportKey), mc?.payouts?.reportKey ? "A payouts report has been posted" : "No payouts report yet (posted after the next advance, or /payouts)")}
          </ul>
        </div>

        <div className="panel mk-setup">
          <h3>1. Add the CFM Manager bot to your server</h3>
          <p>Someone with <strong>Manage Server</strong> opens <a href={BOT_INVITE} target="_blank" rel="noreferrer">this invite link</a> and picks the server. The bot needs to see and send messages, post embeds and files, and <strong>manage channels</strong> (it creates and removes the game channels each week).</p>

          <h3>Admins</h3>
          <p>Anything marked <em>admins</em> below is for people with your server&apos;s own role named <strong>admin</strong> (any capitalization). Create that role and give it to your league admins; it needs no Discord permissions. Until a server has a role called admin, its Discord Administrators count instead.</p>

          <h3>2. Link the server to this league</h3>
          <p>In the server, run <code>/link league:{slug}</code> (Manage Server only). One league per server. The league must be public. Running <code>/link</code> in a different server moves the league there.</p>

          <h3>3. Create the Markets channels</h3>
          <p>An admin runs <code>/marketchannels</code>. The bot makes a <strong>Markets</strong> category, in this order:</p>
          <ul>
            <li><code>#market-feed</code>: the season-long markets at a glance, every bet on them, and weekly odds charts.</li>
            <li><code>#futures</code>: bet the Super Bowl (pick a team), each division (a button per team) and the player awards. For awards, pick a contender or tap <em>Any other player</em> and type a name: any eligible player can be bet on.</li>
            <li><code>#previous-week-payouts</code> (UnbelievaBoat leagues, after the first advance).</li>
            <li>One channel per game this week, where every bet line has Yes/No buttons.</li>
            <li><code>#transactions</code> at the bottom: every bet and cancel this week, cleared after each advance.</li>
          </ul>
          <p>After that it keeps itself up to date: it refreshes after every sync and every bet, and rolls the weekly channels after each advance. <code>/marketupdate</code> (admins) refreshes everything on demand.</p>

          <h3>4. Everyone links their Discord once</h3>
          <p>Each member runs <code>/connect</code> and opens the link while signed in here. That ties their Discord account to their CFM Manager account, so their Discord bets and balance are theirs. It carries over if the league moves to another server.</p>

          <h3>5. Optional: bet your server&apos;s UnbelievaBoat currency</h3>
          <ol className="mk-steps">
            <li><strong>Let CFM Manager read balances.</strong> Someone with Discord&apos;s <strong>Administrator</strong> permission in the server (UnbelievaBoat requires it) opens <a href={UB_AUTHORIZE_URL} target="_blank" rel="noreferrer">UnbelievaBoat&apos;s authorize page</a> and picks the server. CFM Manager only reads balances; it never adds or removes currency.</li>
            <li><strong>Turn it on.</strong> The commissioner picks it below and says whether members keep the currency in <em>cash</em> or <em>bank</em>.</li>
            <li><strong>Give members something to bet</strong> if your server doesn&apos;t already, e.g. <code>!add-money-role cash @Members 100000</code>.</li>
          </ol>
          {commish ? (
            <TicketsSettingForm slug={slug} enabled={Boolean(cfg)} field={cfg?.field ?? own?.field ?? "cash"} />
          ) : (
            <p className="hint small">Only the league&apos;s commissioner can switch currencies{v.userId ? "" : " (sign in first)"}.</p>
          )}
        </div>

        <div className="panel mk-setup">
          <h3>Every week</h3>
          <ul>
            <li><strong>Kickoffs.</strong> When a game is scheduled, either manager runs <code>/kickoff team:… time:9pm</code> (or sets it on the game&apos;s market page). Betting on that game and its player props closes then, or as soon as EA reports the game played. Once a kickoff has passed, only admins can change it.</li>
            <li><strong>Payouts (UnbelievaBoat leagues).</strong> After each advance the bot replaces <code>#previous-week-payouts</code> with one card per member who bet: each settled bet, their net gain or loss, a ready-to-copy <code>!add-money</code> / <code>!remove-money</code> command, and an <strong>Applied</strong> button for admins. Anything not applied carries over to the next report. Members&apos; balances on the site already count these results, so nobody has to wait on the admins to keep betting. <code>/payouts</code> posts the report early.</li>
            <li><strong>Kickoff check.</strong> Each payout card shows the kickoff on record and the member&apos;s last bet on that game. If a kickoff was wrong, an admin runs <code>/verifykickoff team:… time:sat 9pm</code> with the real kickoff: every bet placed after it is voided (still shown in the trade log, marked VOID) and the correction shows up in the next report.</li>
          </ul>
        </div>

        <div className="panel mk-setup">
          <h3>Rules members should know</h3>
          <ul>
            <li>Prices are chances (56% = it happens about 56% of the time) and move with every bet, so earlier bets get better prices. A winning contract pays $1 in play money, or 100 Tickets.</li>
            <li>Until a market locks (kickoff for games and props, settlement for season markets), a bet can be cancelled for what it cost, or what it&apos;s worth then if that&apos;s less. You can&apos;t hold both sides of the same bet.</li>
            <li>A tied game is void and every stake comes back. There are no betting limits.</li>
            <li>Player awards: any eligible player can be bet on (on a team, offense for MVP/OPOY/OROY, defense for DPOY/DROY, rookies for the ROY awards). Players outside the simulation&apos;s top contenders start as long shots.</li>
            <li>Every bet, cancel, payout line and kickoff is in the <Link href={`/l/${slug}/markets/activity`}>public trade log</Link>, which nobody can edit.</li>
          </ul>
        </div>

        <div className="panel mk-setup">
          <h3>Moving to a different Discord server</h3>
          <ol className="mk-steps">
            <li>Run <code>/link league:{slug}</code> in the new server (after step 1 there). The league moves, and the old server&apos;s Markets channels are forgotten; delete them by hand if the bot is still in the old server.</li>
            <li>Run <code>/marketchannels</code> in the new server.</li>
            <li>UnbelievaBoat leagues: authorize the new server (step 5a). Balances come from the new server&apos;s UnbelievaBoat from then on.</li>
            <li>Members don&apos;t need to <code>/connect</code> again.</li>
          </ol>
        </div>

        <div className="panel mk-setup">
          <h3>Commands</h3>
          <div className="tbl-wrap"><table className="tbl">
            <tbody>
              <tr><td><code>/link</code></td><td>Link the server to the league (Manage Server)</td></tr>
              <tr><td><code>/marketchannels</code></td><td>Admins: set up the Markets category</td></tr>
              <tr><td><code>/marketupdate</code></td><td>Admins: refresh every Markets channel with the latest odds, bets and lines</td></tr>
              <tr><td><code>/league</code></td><td>Admins: which league this server shows, with links</td></tr>
              <tr><td><code>/gamechannels year week</code></td><td>A category like &ldquo;2027 - Week 1&rdquo; with a channel per game that week, pinging both managers; rolls over after each advance (admins)</td></tr>
              <tr><td><code>/connect</code></td><td>Link your Discord to your CFM Manager account</td></tr>
              <tr><td><code>/kickoff team time</code></td><td>When betting closes on your game (either manager; admins any time)</td></tr>
              <tr><td><code>/balance</code></td><td>What you can bet: UnbelievaBoat balance, open bets and results not added yet</td></tr>
              <tr><td><code>/bets</code></td><td>Your open bets, with Cancel buttons</td></tr>
              <tr><td><code>/payouts</code></td><td>Admins: post the payouts report now</td></tr>
              <tr><td><code>/verifykickoff team time</code></td><td>Admins: set a finished game&apos;s real kickoff and void later bets</td></tr>
            </tbody>
          </table></div>
        </div>
      </div>
    </main>
  );
}
