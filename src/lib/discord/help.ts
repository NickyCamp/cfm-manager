// /help [topic] [command] (Nick, 2026-11-18: "helps users with set up or anything they may not understand").
//  - /help                 every command, grouped, one line each
//  - /help topic:<pick>    a walkthrough (getting started, server setup, markets, trades…)
//  - /help command:<name>  one command: what it does, where it works, who can run it, its options
// The command list and option text come straight from COMMANDS (commands.ts), so a new command shows up
// here without touching this file; it lands under "Other" until it's added to a group below.
// Answers are private and static, so the route replies at once (no "thinking…").
import { BRAND, EPHEMERAL, type Embed, type Message } from "./api";
import { COMMANDS } from "./commands";
import { HELP_TOPICS } from "./helpTopics";
import { BOT_INVITE_URL } from "./invite";
import { VOTES_NEEDED } from "./tradeChannels";

const APP_URL = (process.env.APP_URL || "https://cfm-manager-delta.vercel.app").replace(/\/$/, "");
const USER_INSTALL_URL = "https://discord.com/oauth2/authorize?client_id=1570587209743073343&integration_type=1&scope=applications.commands";

type Opt = { type: number; name: string; description: string; required?: boolean; options?: Opt[] };
type Cmd = { name: string; description: string; options?: Opt[]; default_member_permissions?: string; contexts?: number[] };
const ALL = COMMANDS as Cmd[];
/** /web: the main site's link, posted for everyone in the chat, with a button to open it. */
export function webReply() {
  return {
    content: APP_URL,
    components: [{ type: 1, components: [{ type: 2, style: 5, label: "Open CFM Manager", url: APP_URL }] }],
    allowed_mentions: { parse: [] as string[] },
  };
}

const byName = (n: string) => ALL.find((c) => c.name === n.replace(/^\//, "").trim().toLowerCase());

// The overview's groups, in order. Commands missing from every group go under "Other".
const GROUPS: [string, string[]][] = [
  ["🚀 Start here", ["help", "web", "myleague", "connect", "league"]],
  ["🏈 Players and teams", ["player", "contract", "amnesty", "team", "players", "rookie", "expiring"]],
  ["💰 Cap", ["cap"]],
  ["📊 Games and stats", ["tws", "scores", "schedule", "streamlink", "live", "redzone", "standings", "playoffs", "stats", "funfact", "sync"]],
  ["🔁 Trades", ["trade", "tradeblock"]],
  ["🎟️ Markets", ["kickoff", "balance", "bets"]],
  ["🔎 Audits", ["audit"]],
  ["🃏 Packs", ["pack", "packs"]],
  ["🛠️ Server setup (Manage Server)", ["link", "unlink", "notify"]],
  ["🛡️ League admins", ["gamechannels", "set", "activitychannels", "marketchannels", "marketupdate", "tradechannels", "transactionchannels", "auditchannels", "packchannels", "betcap", "economy", "payouts", "verifykickoff"]],
  ["🎬 Bot owner", ["alertvideo", "removealertvideo"]],
];

/** Who can run a command, from how it's registered and its description's "Admins:" / "Bot owner only:" prefix. */
function whoCanRun(c: Cmd): string {
  if (/^bot owner only/i.test(c.description)) return "Only the bot's owner (and only people with Manage Server can see it)";
  if (/^admins:/i.test(c.description)) return "League admins: anyone with the server's role named **admin**";
  if (c.default_member_permissions) return "People with **Manage Server** in this Discord";
  return "Anyone";
}
function whereItWorks(c: Cmd): string {
  return c.contexts && !c.contexts.includes(1)
    ? "Only in a Discord server the bot was added to (and linked with /link)"
    : "Anywhere: league servers, other servers, DMs and group DMs (with the bot added to your account)";
}
const cleanDesc = (d: string) => { const t = d.replace(/^(admins|bot owner only):\s*/i, ""); return t.charAt(0).toUpperCase() + t.slice(1); };
const optLine = (o: Opt) => `• \`${o.name}\`${o.required ? " (required)" : ""}: ${o.description}`;

// Extra tips for commands where the one-line description isn't enough.
const TIPS: Record<string, string> = {
  streamlink: "`/streamlink link:twitch.tv/yourname` links your stream to your Discord (Kick and YouTube @handle links work too); `link:remove` clears it. If your Discord is linked with /connect, it also shows on your team's row on the site's Live tab. Admins can add `team:` to set a team's.",
  live: "Posts your stream link in the channel, saying whether you're live. Link it first with /streamlink.",
  redzone: "Lists everyone in the league streaming right now with links. The site's Live tab has them all embedded.",
  help: "`/help topic:Getting started` is the place to begin. `/help command:cap` explains one command.",
  myleague: "Use the part after /l/ in your league's web address, e.g. `/myleague league:ncl`. Run it with no league to see or clear yours. A linked server always uses its own league instead.",
  connect: "Open the link while signed in to the site. Linking lets you use /league, bet in the Markets, and manage your own team's trade block and nicknames.",
  league: "Example: `/league league:ncl player:Patrick Mahomes`. Pick the league first, then fill **one** box (player, tws, stats, team, cap, contract or more). The week, year, group, rating and order boxes add to it.",
  players: "Leave team empty for the league-wide top 25 (e.g. `/players group:WR rating:Speed`). Leave group empty for every position. Pick a rating (Overall, Speed, Throw Power…) and/or an order to sort best to worst or worst to best; a group also shows its league rank.",
  player: "Start typing and pick the name from the list. The reply is the player's card, front and back.",
  cap: "`/cap team:BUF year:2028` focuses that season. `/cap year:2028` with no team lists every team's projected space.",
  schedule: "Leave it empty for this week's games (scores once they're final, kickoffs if set). Pick a team for its whole season, byes and playoffs included; ▶ marks this week.",
  tws: "Leave week empty for this week's matchup. Playoffs: week 19 Wild Card, 20 Divisional, 21 Conference, 22 Super Bowl.",
  stats: "Add `by:Teams` to rank every team by its season total (e.g. `/stats category:Sacks by:Teams`); with a team picked too, that team is highlighted. Regular season only. For players, rate stats (completion %, passer rating, YPC, FG %, punt average) need a minimum number of attempts to qualify.",
  sync: "Pulls from EA now instead of waiting for the schedule. Once every 15 minutes per league; usually takes 2–4 minutes.",
  trade: "Opens a private builder: pick the teams, add players and picks, check the score, then submit it to #trade-proposals for the admins to vote on.",
  tradeblock: "Anyone can look things up. To list one of your own players: `action:Add a player player:<name> note:<what you want>`.",
  kickoff: "Set it when you've scheduled your game in chat, e.g. `/kickoff time:sat 7pm`. Betting on the game closes then.",
  link: "Use the part after /l/ in your league's web address, e.g. `/link league:ncl`. One league per server, and the league must be public.",
  notify: "Pick a channel to get a post each time the league advances. Run it with no channel to turn it off.",
  audit: "Pick abilities, games or players; add a team to check just that team. Results post in the Audits category for everyone.",
  gamechannels: "Each week you pick gets its own category; other weeks stay. Leave year and week empty for this week. Run it again for a week to refresh it. `action:Remove` with a week deletes just that week's category. After a sync, each finished game gets its box score posted in its channel, and the channel closes 12 hours later (the category goes once every game in it is closed). When the league advances, the earlier weeks' categories are deleted at the next sync, channels and all.",
  set: "`/set force` picks a game channel from your game channel categories (any week), then Force Win, Force Loss or Force Sim (win/loss also need the team). For activity, a Force Win counts as a game played for the winning team's user and a miss for the other (Force Loss: the other team's user played); pick `activity` to choose differently (one team or Both teams). Force Sim credits nobody unless `activity` is picked. The channel is renamed and the game counts as simmed: its bets come back and /audit skips it. `/set disconnect` marks a game that disconnected and won't be replayed: both users get a game played even if it sims, and its bets are voided (the channel gets -disconnect). Add `winner` to track which team admins set to win in game; it only changes the channel name to -disconnect-win-<team>. `/set played` is for a game both users played that EA didn't report before the advance (activity shows it as \"not counted\"): both get a game played, /audit includes it, and bets stand. `/set remove` takes a Force, Disconnect or Played mark back off.",
  activitychannels: "Makes the bot-only #activity-tracker-week, counting from the current week. Played games post after every sync; after each advance a wrap-up lists /set forces (the `activity` team gets a game played) and games nobody played (a miss for both users). Season totals stay at the top.",
  marketchannels: "Deletes and rebuilds the whole Markets category. Use /marketupdate to just refresh it.",
  betcap: "Run it with no numbers to see the current caps. 0 means no cap.",
  economy: "Run it with no numbers to see the current settings. Whole percents, e.g. `cut:5`.",
};
const TOPIC_OF: Record<string, string> = {
  link: "setup", unlink: "setup", notify: "setup", gamechannels: "setup", set: "setup", activitychannels: "setup", marketchannels: "markets", marketupdate: "markets",
  tradechannels: "trades", transactionchannels: "setup", auditchannels: "audits", packchannels: "packs", betcap: "markets",
  economy: "markets", payouts: "markets", verifykickoff: "markets", kickoff: "markets", balance: "markets", bets: "markets",
  trade: "trades", tradeblock: "trades", audit: "audits", pack: "packs", packs: "packs", myleague: "start", connect: "start",
  league: "lookups", schedule: "lookups", player: "lookups", cap: "lookups", tws: "lookups", stats: "lookups",
};
const topicLabel = (k: string) => HELP_TOPICS.find(([v]) => v === k)?.[1] ?? k;

function overview(): Embed {
  const seen = new Set<string>();
  const fields = GROUPS.map(([name, names]) => {
    const cmds = names.map(byName).filter((c): c is Cmd => Boolean(c));
    cmds.forEach((c) => seen.add(c.name));
    return { name, value: cmds.map((c) => `\`/${c.name}\` ${cleanDesc(c.description)}`).join("\n").slice(0, 1024) };
  }).filter((f) => f.value);
  const other = ALL.filter((c) => !seen.has(c.name));
  if (other.length) fields.push({ name: "➕ Other", value: other.map((c) => `\`/${c.name}\` ${cleanDesc(c.description)}`).join("\n").slice(0, 1024) });
  // Discord caps a whole embed at 6,000 characters; trim the longest groups' lines to names only if needed.
  let total = fields.reduce((n, f) => n + f.name.length + f.value.length, 0);
  for (const f of [...fields].sort((a, b) => b.value.length - a.value.length)) {
    if (total <= 5200) break;
    const short = f.value.split("\n").map((l) => l.split(" ")[0]).join(" ");
    total -= f.value.length - short.length;
    f.value = short;
  }
  return {
    title: "CFM Manager bot: commands",
    url: APP_URL,
    color: BRAND,
    description: "New here? Try `/help topic:Getting started`.\nStuck on one command? `/help command:<name>` explains it.",
    fields,
    footer: { text: "Only you can see this. Names autocomplete: start typing and pick from the list." },
  };
}

function commandHelp(name: string): Embed | null {
  const c = byName(name);
  if (!c) return null;
  const opts = c.options || [];
  const subs = opts.filter((o) => o.type === 1);
  const fields: { name: string; value: string; inline?: boolean }[] = [
    { name: "Who can run it", value: whoCanRun(c) },
    { name: "Where it works", value: whereItWorks(c) },
  ];
  if (subs.length) {
    fields.push({ name: "Pick one", value: subs.map((s) => `• \`/${c.name} ${s.name}\`: ${s.description}${s.options?.length ? ` (options: ${s.options.map((o) => o.name).join(", ")})` : ""}`).join("\n").slice(0, 1024) });
  } else if (opts.length) {
    fields.push({ name: "Options", value: opts.map(optLine).join("\n").slice(0, 1024) });
  } else {
    fields.push({ name: "Options", value: "None, just run it." });
  }
  if (TIPS[c.name]) fields.push({ name: "Tip", value: TIPS[c.name] });
  if (TOPIC_OF[c.name]) fields.push({ name: "More", value: `\`/help topic:${topicLabel(TOPIC_OF[c.name])}\`` });
  return { title: `/${c.name}`, color: BRAND, description: cleanDesc(c.description), fields, footer: { text: "Only you can see this." } };
}

function topicHelp(key: string): Embed | null {
  const T: Record<string, string> = {
    start: [
      `**1. Get your league on the site.** Someone in the league signs in at ${APP_URL}, connects their EA account and picks the league. It gets a page at \`${APP_URL.replace(/^https?:\/\//, "")}/l/<name>\`; the part after /l/ is the league's **web address**, used below.`,
      "**2. Point the bot at your league.**",
      "• In your league's Discord: someone with Manage Server runs `/link league:<web address>`. Everyone's commands there then use that league.",
      `• Anywhere else (DMs, group chats, other servers): [add the bot to your own account](${USER_INSTALL_URL}), then run \`/myleague league:<web address>\`.`,
      "**3. Link your Discord to your site account** with `/connect`. You need this to bet in the Markets, use `/league` for every league you're in, and manage your own team (trade block, nicknames).",
      "**4. Try it:** `/player`, `/cap team:<your team>`, `/tws team:<your team>`, `/standings`.",
      "Server admins: see `/help topic:Setting up a server (admins)`.",
    ].join("\n"),
    setup: [
      `**1. Add the bot.** Someone with Manage Server opens [this invite](${BOT_INVITE_URL}) and picks the server. Keep its permissions: it needs **Manage Channels** and **Manage Roles** to build the bot-only categories.`,
      "**2. Make an `admin` role.** Create a role named **admin** and give it to your league admins; it needs no Discord permissions. That role is what \"admins\" means for this bot. Until a server has one, its Discord Administrators count instead.",
      "**3. Link the league:** `/link league:<web address>`. One league per server; the league must be public.",
      "**4. Advance alerts:** `/notify channel:#announcements` posts every time the league advances.",
      "**5. Optional categories** (admins). Each builds its own category; run it again to repair, or add `action:Remove` to delete it:",
      "• `/gamechannels`: a category per week with a channel per game, tagging both teams' roles",
      "• `/marketchannels`: the Markets (bet buttons, futures, payouts)",
      "• `/tradechannels`: trade proposals, admin votes, approvals",
      "• `/transactionchannels`: scores, injuries, rating changes, cuts, trades",
      "• `/auditchannels`: rule audit results",
      "• `/packchannels`: card packs only work in there",
      "Every admin command is also on the site's league **Admin** page.",
    ].join("\n"),
    lookups: [
      "**Names autocomplete.** Start typing a player or team and pick from the list; typed names that aren't picked often won't match.",
      "• `/player`: the player's card, front and back (ratings, stats, contract)",
      "• `/contract`: what he'll likely ask for on his next deal",
      "• `/amnesty`: his full contract, then the new contract the commissioner sets so cutting him costs exactly 50% of today's penalty: all in one season, or 25% + 25% over two",
      "• `/team`: a team · `/players team group rating order`: players sorted by any rating, best to worst or worst to best. Leave team empty for the whole league (top 25)",
      "• `/cap team year`: cap space now and in future seasons; `/cap year:2028` alone lists every team",
      "• `/tws team week`: this week's matchup or a past game. Playoff weeks: 19 Wild Card, 20 Divisional, 21 Conference, 22 Super Bowl",
      "• `/stats category team`: top 10 in a stat (`by:Teams` ranks every team)",
      "• `/scores`, `/schedule`, `/standings`, `/playoffs`, `/rookie`, `/expiring`, `/funfact`",
      "**Another league?** `/league league:<pick> player:<name>` looks things up in any league you're in, from any Discord. Pick the league first, then fill one box.",
      "**Data looks old?** `/sync` pulls from EA now (once every 15 minutes).",
    ].join("\n"),
    markets: [
      "**Prices are chances.** 40% means it happens about 4 times in 10. Prices move with what members bet, so betting early gets a better price.",
      "**To bet:** run `/connect` once, then tap a bet button in the Markets channels (or bet on the site's Markets tab).",
      "• `/balance`: what you have free to bet. `/bets`: your open bets, with Cancel / Cash out buttons",
      "• Game and prop bets can be cancelled until kickoff. Season-long bets (Super Bowl, divisions, awards) can be cashed out instead, less a small fee",
      "• Nobody can bet on their own game (either side) or against their own team",
      "**Kickoff:** when you schedule your game, set it with `/kickoff time:sat 7pm`. Betting on it closes then. Admins can fix a wrong one after with `/verifykickoff`; bets placed after the real kickoff are voided.",
      "**Admins:** `/marketchannels` builds the channels, `/marketupdate` refreshes them, `/betcap` and `/economy` set limits and the house rules, `/payouts` posts the payouts report.",
      `Full guide, including UnbelievaBoat Tickets: the **Setup guide** link at the bottom of the site's Markets tab.`,
    ].join("\n"),
    trades: [
      "**Proposing:** agree a trade with the other manager, then run `/trade` (or use the site's Trade Tool). Pick both teams, add players and picks, check the score and cap impact, then submit.",
      `**Voting:** it posts in #trade-proposals, where only admins can vote. ${VOTES_NEEDED} approvals passes it (${VOTES_NEEDED} rejections fails it). Passed trades post in the approvals channel, where anyone can comment.`,
      "**Making it official:** do the trade in Madden. Once a sync picks it up, it posts in the trade transactions channel.",
      "**Trade block:** `/tradeblock` shows who's available, by team and/or position. Managers list their own players with `action:Add a player player:<name> note:<what you want>`.",
      "Admins set up the channels with `/tradechannels`. Add `admin_channel:` (e.g. a private #trade-chat) to also post each proposal there with the same vote buttons; a vote in either spot counts once and updates both.",
    ].join("\n"),
    audits: [
      "**`/audit` checks the league's rules** and posts the results in the Audits category for everyone:",
      "• `/audit abilities`: banned abilities and too many of a limited one",
      "• `/audit games`: catch shares and the passing/rushing TD split in user games (simmed games don't count)",
      "• `/audit players`: position changes (allowed moves and timing)",
      "Add `team:` to check just one team.",
      "**Admins:** `/auditchannels` makes the category. The rules themselves (banned abilities, limits, position-change rules) are edited on the site: league **Admin** → Rule audits.",
    ].join("\n"),
    packs: [
      "**`/pack`** opens 5 random cards from the league's rostered players. Rarity follows dev trait: X-Factors are the rarest (about 1 card in 100).",
      "Each card scores points (more for rarer and higher-rated players), and the pack gets a luck label from Bricks to Insane.",
      "**`/packs`** shows the craziest packs ever pulled, your own best, and the odds.",
      "If an admin ran `/packchannels`, packs only work in the Packs category.",
    ].join("\n"),
    trouble: [
      "**A command doesn't show up.** New commands can take a few minutes; restarting Discord helps. If others in a server can't see any commands, the bot was probably only added to someone's own account: someone with Manage Server needs to add it to the server (`/help topic:Setting up a server (admins)`).",
      "**\"No league set.\"** In a league server, an admin runs `/link`. Anywhere else, run `/myleague league:<web address>`.",
      "**\"Only people with the admin role…\"** Ask a league admin, or have the server create a role named **admin**.",
      "**Can't link: the league is private.** Only public leagues can be linked to Discord.",
      "**A name isn't found.** Pick it from the autocomplete list instead of typing it all out.",
      "**The data looks out of date.** The league syncs on a schedule after it advances; `/sync` pulls now (once every 15 minutes).",
      "**Can't bet.** Run `/connect` first. Betting closes at kickoff, and you can't bet on your own game.",
      "**\"This interaction failed\" or \"Something went wrong.\"** Try again in a minute; Discord gives the bot only a few seconds.",
      "Still stuck? Ask in your league chat, or tell the league's commissioner.",
    ].join("\n"),
  };
  const body = T[key];
  if (!body) return null;
  return { title: topicLabel(key), url: APP_URL, color: BRAND, description: body.slice(0, 4000), footer: { text: "Only you can see this. /help for every command." } };
}

/** The /help reply: always private. */
export function helpReply(opts: { topic?: string; command?: string }): Message {
  const embeds: Embed[] = [];
  let note = "";
  if (opts.topic) {
    const e = topicHelp(opts.topic);
    if (e) embeds.push(e);
  }
  if (opts.command) {
    const e = commandHelp(opts.command);
    if (e) embeds.push(e);
    else note = `There's no \`/${opts.command.replace(/^\//, "")}\` command. Here's everything the bot can do:`;
  }
  if (!embeds.length) embeds.push(overview());
  return { content: note || undefined, embeds, flags: EPHEMERAL, allowed_mentions: { parse: [] } };
}

/** /help command:<typing…> — every command name, filtered by what's typed. */
export function helpAutocomplete(q: string): { name: string; value: string }[] {
  const n = q.replace(/^\//, "").trim().toLowerCase();
  return ALL
    .filter((c) => !n || c.name.includes(n) || c.description.toLowerCase().includes(n))
    .sort((a, b) => Number(!a.name.startsWith(n)) - Number(!b.name.startsWith(n)) || a.name.localeCompare(b.name))
    .slice(0, 25)
    .map((c) => ({ name: `/${c.name}: ${cleanDesc(c.description)}`.slice(0, 100), value: c.name }));
}
