// The bot's slash commands, as Discord's API wants them.
// .github/workflows/discord-commands.yml registers these with Discord whenever
// this file changes on main (scripts/discord/register.ts), so editing this list
// is all it takes to add or change a command.

import { ALERT_EVENTS } from "./api";
import { STAT_CATS } from "./stats";
import { DISCORD_POS_GROUPS } from "./posGroups";
import { AUDIT_KINDS } from "./audit";
import { HELP_TOPICS } from "./helpTopics";

const SUB_COMMAND = 1, STRING = 3, CHANNEL = 7, INTEGER = 4, ATTACHMENT = 11;
const MANAGE_SERVER = String(1 << 5);

// Where a command can be used. Server setup commands need the bot added to the
// server; everything else also works when someone installs the bot to their own
// account (user install) — in DMs, group DMs and other servers.
const SERVER_ONLY = { integration_types: [0], contexts: [0] };
const ANYWHERE = { integration_types: [0, 1], contexts: [0, 1, 2] };

const player = { type: STRING, name: "player", description: "Start typing a name", required: true, autocomplete: true };
const group = (required: boolean) => ({ type: STRING, name: "group", description: "Position group (OL, DL, DB…)", required, choices: DISCORD_POS_GROUPS.map((g) => ({ name: g.name, value: g.key })) });
const rating = { type: STRING, name: "rating", description: "Sort by a rating: Overall, Speed, Throw Power… (start typing)", required: false, autocomplete: true };
const order = { type: STRING, name: "order", description: "Best to worst (default) or worst to best", required: false, choices: [{ name: "Best to worst", value: "desc" }, { name: "Worst to best", value: "asc" }] };
const team = (required: boolean) => ({ type: STRING, name: "team", description: "Start typing a team", required, autocomplete: true });

// /league's "more" box: the commands that don't have a box of their own (they read the player/team/week/year boxes).
export const LEAGUE_MORE: [string, string][] = [
  ["standings", "Standings"], ["playoffs", "Playoff picture"], ["scores", "Scores (week box)"], ["schedule", "Schedule (team or week box)"], ["cap", "League cap space (year box)"],
  ["rookie", "Top rookies (team box)"], ["expiring", "Expiring contracts (team box)"], ["funfact", "Fun fact (player or team box)"], ["pack", "Open a pack"],
  ["packs", "Pack leaderboard"], ["sync", "Sync now (pull from EA)"], ["info", "League info and links"],
];

const PLAIN = [
  {
    // /help (Nick, 2026-11-18): every command, a walkthrough topic, or one command explained. Private reply.
    name: "help",
    description: "How to use the bot: every command, setup walkthroughs, or one command explained",
    ...ANYWHERE,
    options: [
      { type: STRING, name: "topic", description: "A walkthrough: getting started, server setup, markets, trades…", required: false, choices: HELP_TOPICS.map(([value, name]) => ({ name, value })) },
      { type: STRING, name: "command", description: "One command explained (start typing its name)", required: false, autocomplete: true },
    ],
  },
  // /web (Nick, 2026-11-18): just posts the link to the main site. Public reply.
  { name: "web", description: "Post the link to the CFM Manager website", ...ANYWHERE },
  {
    name: "link",
    description: "Connect this Discord server to a CFM Manager league",
    default_member_permissions: MANAGE_SERVER,
    ...SERVER_ONLY,
    options: [{ type: STRING, name: "league", description: "The league's web address, e.g. ncl (from cfm-manager…/l/ncl)", required: true }],
  },
  { name: "unlink", description: "Disconnect this server from its league", default_member_permissions: MANAGE_SERVER, ...SERVER_ONLY },
  {
    name: "notify",
    description: "Post a message when the league advances; leave empty to turn off",
    default_member_permissions: MANAGE_SERVER,
    ...SERVER_ONLY,
    options: [{ type: CHANNEL, name: "channel", description: "Where to post advance alerts", required: false, channel_types: [0, 5] }],
  },
  {
    name: "alertvideo",
    description: "Bot owner only: upload a video that plays with an update (e.g. a team over the cap)",
    default_member_permissions: MANAGE_SERVER,
    ...SERVER_ONLY,
    options: [
      { type: STRING, name: "event", description: "When to post it", required: true, choices: Object.entries(ALERT_EVENTS).map(([value, name]) => ({ name, value })) },
      { type: ATTACHMENT, name: "video", description: "The video (MP4/MOV/WebM, up to 10 MB)", required: true },
    ],
  },
  {
    name: "removealertvideo",
    description: "Bot owner only: stop playing the video for an update",
    default_member_permissions: MANAGE_SERVER,
    ...SERVER_ONLY,
    options: [{ type: STRING, name: "event", description: "Which update", required: true, choices: Object.entries(ALERT_EVENTS).map(([value, name]) => ({ name, value })) }],
  },
  {
    name: "myleague",
    description: "Set your own league, used in DMs, group DMs and servers that aren't linked",
    ...ANYWHERE,
    options: [{ type: STRING, name: "league", description: "The league's web address, e.g. ncl; leave empty to see or clear yours", required: false }],
  },
  { name: "player", description: "A player's ratings, contract and cap hit by year", ...ANYWHERE, options: [player] },
  { name: "contract", description: "What a player will likely ask for on his next deal", ...ANYWHERE, options: [player] },
  {
    name: "cap",
    description: "Cap space now and projected; pick a team for its breakdown and a season to focus on",
    ...ANYWHERE,
    options: [team(false), { type: INTEGER, name: "year", description: "Season, e.g. 2028 (this season and the next 4)", required: false, min_value: 2000, max_value: 2100 }],
  },
  { name: "team", description: "A team's record, cap space and best players", ...ANYWHERE, options: [team(true)] },
  {
    name: "players",
    description: "Players by team and/or position group, sorted by any rating; no team = the whole league",
    ...ANYWHERE,
    options: [{ ...team(false), description: "Start typing a team; leave empty for the whole league" }, group(false), rating, order],
  },
  { name: "expiring", description: "A team's top 10 expiring contracts by overall, with each player's projected ask", ...ANYWHERE, options: [team(true)] },
  { name: "rookie", description: "Top 10 rookies by overall, or a team's whole class; pick a team and/or a draft year", ...ANYWHERE, options: [team(false), { type: INTEGER, name: "year", description: "Draft class year, e.g. 2027 (default: the newest class)", required: false, min_value: 2000, max_value: 2100 }] },
  {
    name: "tws",
    description: "A team's game: this week's matchup with ranks, or a past (or preseason) week's score and stats",
    ...ANYWHERE,
    options: [team(true), { type: INTEGER, name: "week", description: "Week 1-18; playoffs: 19 Wild Card, 20 Divisional, 21 Conference, 22 Super Bowl", required: false, min_value: 1, max_value: 22 }, { type: INTEGER, name: "preseason", description: "A preseason week (1-4) instead of a regular-season week", required: false, min_value: 1, max_value: 4 }],
  },
  { name: "pack", description: "Open a pack of 5 league player cards (X-Factors are the rarest)", ...ANYWHERE },
  { name: "packs", description: "Pack leaderboard: most points from pulls, plus your own stats and the odds", ...ANYWHERE },
  {
    name: "funfact",
    description: "A random fun fact about a player or team from this season's numbers (or leave empty)",
    ...ANYWHERE,
    options: [{ ...player, required: false }, team(false)],
  },
  {
    name: "stats",
    description: "Top 10 in a stat this regular season (passing yards, INTs thrown, sacks…), league-wide or one team",
    ...ANYWHERE,
    options: [
      { type: STRING, name: "category", description: "Which stat", required: true, choices: STAT_CATS.map((c) => ({ name: c.label, value: c.key })) },
      team(false),
    ],
  },
  { name: "sync", description: "Pull the latest league data from EA now (once every 15 minutes per league)", ...ANYWHERE },
  { name: "standings", description: "Division standings", ...ANYWHERE },
  { name: "playoffs", description: "Playoff picture with NFL tiebreakers", ...ANYWHERE },
  {
    // /schedule (Nick, 2026-11-19): empty = this week's games (scores once final); a team = its whole season.
    name: "schedule",
    description: "This week's games and scores, or pick a team for its whole season schedule",
    ...ANYWHERE,
    options: [
      team(false),
      { type: INTEGER, name: "week", description: "Without a team: week 1-18; playoffs 19 Wild Card, 20 Divisional, 21 Conference, 22 Super Bowl", required: false, min_value: 1, max_value: 22 },
    ],
  },
  {
    name: "scores",
    description: "Scores for a week (default: the latest week with a final)",
    ...ANYWHERE,
    options: [{ type: INTEGER, name: "week", description: "Regular-season week number", required: false, min_value: 1, max_value: 18 }],
  },
];

export const COMMANDS = [
  ...PLAIN,
  // "Admins" = the server's own role named "admin" (Nick, 2026-11-14). Discord can't limit a command to a
  // role by name, so these show for everyone and src/lib/discord/admin.ts checks the role when they run.
  // /league league:<pick> <box>:<value>: the everyday commands for any league you're in, from any Discord
  // (Nick, 2026-11-14), e.g. /league league:eml27 player:Patrick Mahomes or tws:Eagles. Fill one box;
  // names come from the picked league.
  {
    name: "league",
    description: "Any league you're in, from any Discord: pick the league, then player, tws, stats…",
    ...ANYWHERE,
    options: [
      { type: STRING, name: "league", description: "Start typing: every league you're in (link your account with /connect)", required: true, autocomplete: true },
      { type: STRING, name: "player", description: "A player's card (start typing a name from that league)", required: false, autocomplete: true },
      { type: STRING, name: "tws", description: "A team's game this week (or the week box): start typing a team", required: false, autocomplete: true },
      { type: STRING, name: "stats", description: "Top 10 in a stat this season (add the team box for one team)", required: false, choices: STAT_CATS.map((c) => ({ name: c.label, value: c.key })) },
      { type: STRING, name: "team", description: "A team's page (start typing a team); add the group box for one position group", required: false, autocomplete: true },
      { type: STRING, name: "cap", description: "A team's cap space by year (add the year box to focus a season)", required: false, autocomplete: true },
      { type: STRING, name: "contract", description: "What a player will likely ask for on his next deal", required: false, autocomplete: true },
      { type: STRING, name: "more", description: "Standings, playoffs, scores, schedule, rookies, expiring deals, fun fact, packs, league info", required: false, choices: LEAGUE_MORE.map(([value, name]) => ({ name, value })) },
      { ...group(false), description: "Players in one position group (OL, DL, DB…); with the team box, just that team" },
      { ...rating, description: "Sort players by a rating (start typing); add team or group to narrow it" },
      { ...order, description: "With rating: best to worst (default) or worst to best" },
      { type: INTEGER, name: "week", description: "For tws/scores: week 1-18; tws playoffs 19 WC, 20 Div, 21 Conf, 22 SB", required: false, min_value: 1, max_value: 22 },
      { type: INTEGER, name: "preseason", description: "For tws: a preseason week (1-4) instead of a regular-season week", required: false, min_value: 1, max_value: 4 },
      { type: INTEGER, name: "year", description: "For cap: season, e.g. 2028; for rookies: draft class year", required: false, min_value: 2000, max_value: 2100 },
    ],
  },

  { name: "marketchannels", description: "Admins: delete and rebuild the Markets category from scratch (payouts channel kept)", ...SERVER_ONLY },
  { name: "marketupdate", description: "Admins: refresh every Markets channel with the latest odds, bets and lines", ...SERVER_ONLY },
  {
    // /set (Nick, 2026-11-19): force a result on one of this week's games, or take it back.
    name: "set",
    description: "Admins: Force Win, Force Loss or Force Sim on a game in your game channel categories",
    ...SERVER_ONLY,
    options: [
      {
        type: SUB_COMMAND, name: "force", description: "Force Win, Force Loss or Force Sim on a game channel",
        options: [
          { type: STRING, name: "game", description: "A game channel from your game channel categories (start typing a team)", required: true, autocomplete: true },
          { type: STRING, name: "result", description: "Force Win, Force Loss or Force Sim", required: true, choices: [{ name: "Force Win", value: "win" }, { name: "Force Loss", value: "loss" }, { name: "Force Sim", value: "sim" }] },
          { type: STRING, name: "team", description: "For Force Win/Loss: the team that gets the win or the loss", required: false, autocomplete: true },
          { type: STRING, name: "activity", description: "The team whose user gets this counted as a game played, not missed (or Both teams)", required: false, autocomplete: true },
        ],
      },
      {
        // Nick, 2026-11-19: "the game disconnected but both users who played get credit for playing even if the game sims"
        type: SUB_COMMAND, name: "disconnect", description: "The game disconnected and won't be replayed: both users get credit for playing it",
        options: [{ type: STRING, name: "game", description: "A game channel from your game channel categories (start typing a team)", required: true, autocomplete: true }],
      },
      {
        type: SUB_COMMAND, name: "remove", description: "Remove a Force or Disconnect set earlier on a game",
        options: [{ type: STRING, name: "game", description: "A game with a Force on it", required: true, autocomplete: true }],
      },
    ],
  },
  {
    name: "gamechannels",
    description: "Admins: a new category per week (e.g. 2027 - Week 1) with a channel per game; empty = this week",
    ...SERVER_ONLY,
    options: [
      { type: INTEGER, name: "year", description: "Season, e.g. 2027 (only the current season's schedule is loaded)", required: false, min_value: 2000, max_value: 2100 },
      { type: INTEGER, name: "week", description: "Week 1-18; playoffs: 19 Wild Card, 20 Divisional, 21 Conference, 22 Super Bowl", required: false, min_value: 1, max_value: 22 },
      { type: STRING, name: "action", description: "Leave empty to build/refresh that week; Remove deletes that week's category", required: false, choices: [{ name: "Remove", value: "remove" }] },
    ],
  },
  {
    name: "tradeblock",
    description: "Who's on the trade block, by team and/or position; managers add or remove their players",
    ...ANYWHERE,
    options: [
      team(false),
      { type: STRING, name: "position", description: "Position group (QB, WR, OL, DL…)", required: false, choices: DISCORD_POS_GROUPS.map((g) => ({ name: g.name, value: g.key })) },
      { type: STRING, name: "action", description: "Managers: add or remove one of your players (fill the player box)", required: false, choices: [{ name: "Add a player", value: "add" }, { name: "Remove a player", value: "remove" }] },
      { ...player, required: false, description: "With action: the player to add or remove" },
      { type: STRING, name: "note", description: "With Add: what you're looking for, e.g. 2nd round pick or a CB", required: false, max_length: 100 },
    ],
  },
  {
    // /audit abilities | games | players (Nick, 2026-11-18). Rules are edited on the site: Admin → Rule audits.
    name: "audit",
    description: "Check the league rules for breaks; results post in the Audits category for everyone",
    ...SERVER_ONLY,
    options: Object.entries(AUDIT_KINDS).map(([name, description]) => ({
      type: SUB_COMMAND, name, description,
      options: [team(false)],
    })),
  },
  {
    // /activitychannels (Nick, 2026-11-19): #activity-tracker-week, games played and missed per user.
    name: "activitychannels",
    description: "Admins: make #activity-tracker-week, tracking each user's games played and missed",
    ...SERVER_ONLY,
    options: [
      { type: STRING, name: "action", description: "Leave empty to make, repair or catch it up; Remove deletes it and its counts", required: false, choices: [{ name: "Remove", value: "remove" }] },
    ],
  },
  {
    name: "auditchannels",
    description: "Admins: make the bot-only Audits category (ability, game and player audits)",
    ...SERVER_ONLY,
    options: [
      { type: STRING, name: "action", description: "Leave empty to make or repair it; Remove deletes the Audits category", required: false, choices: [{ name: "Remove", value: "remove" }] },
    ],
  },
  { name: "trade", description: "Build a trade step by step (teams, players, picks), see its score and submit it", ...SERVER_ONLY },
  {
    name: "tradechannels",
    description: "Admins: make the Trades category: proposals (admins vote), approvals, transactions",
    ...SERVER_ONLY,
    options: [
      { type: STRING, name: "action", description: "Leave empty to make it; Remove deletes the Trades category", required: false, choices: [{ name: "Remove", value: "remove" }, { name: "Admin copy off", value: "adminoff" }] },
      { type: CHANNEL, name: "admin_channel", description: "Admins-only channel that also gets each proposal with the vote buttons", required: false, channel_types: [0] },
    ],
  },
  {
    name: "transactionchannels",
    description: "Admins: make the bot-only Transactions category (scores, injuries, ratings, cuts, trades…)",
    ...SERVER_ONLY,
    options: [
      { type: STRING, name: "action", description: "Empty: make or repair it. Repost history: post all saved moves again. Remove: delete it", required: false, choices: [{ name: "Repost history", value: "history" }, { name: "Remove", value: "remove" }] },
    ],
  },
  {
    name: "packchannels",
    description: "Admins: make the Packs category; /pack and /packs then only work in there",
    ...SERVER_ONLY,
    options: [
      { type: STRING, name: "action", description: "Leave empty to make it; Remove deletes it (packs work anywhere again)", required: false, choices: [{ name: "Remove", value: "remove" }] },
    ],
  },
  { name: "connect", description: "Link your Discord to your CFM Manager account (for betting league Tickets)", ...ANYWHERE },
  { name: "balance", description: "Your Tickets free to bet: UnbelievaBoat balance, open bets and results not added yet", ...SERVER_ONLY },
  { name: "bets", description: "Your open bets, with buttons to cancel", ...SERVER_ONLY },
  {
    name: "betcap",
    description: "Admins: cap each bet and each user's total per Madden week (0 = no cap); empty = show caps",
    ...SERVER_ONLY,
    options: [
      { type: INTEGER, name: "per_bet", description: "Most one bet can be (Tickets, or $ in play money); 0 = no cap", required: false, min_value: 0, max_value: 100000000 },
      { type: INTEGER, name: "per_user", description: "Most one user can bet in one Madden week, all bets together; 0 = no cap", required: false, min_value: 0, max_value: 100000000 },
    ],
  },
  {
    name: "economy",
    description: "Admins: the house cut of winnings, lowest price and cash-out fee (in %); empty = show them",
    ...SERVER_ONLY,
    options: [
      { type: INTEGER, name: "cut", description: "% of a winning bet's profit kept by the house (default 5)", required: false, min_value: 0, max_value: 50 },
      { type: INTEGER, name: "floor", description: "Lowest price a bet can buy at, in % (default 3: long shots pay at most 33x)", required: false, min_value: 0, max_value: 20 },
      { type: INTEGER, name: "cashout_fee", description: "% kept when a futures bet is cashed out (default 2)", required: false, min_value: 0, max_value: 50 },
    ],
  },
  { name: "payouts", description: "Admins: post the payouts report now (normally posted after each advance)", ...SERVER_ONLY },
  {
    name: "verifykickoff",
    description: "Admins: set a finished game's real kickoff; bets placed after it are voided",
    ...SERVER_ONLY,
    options: [
      team(true),
      { type: STRING, name: "time", description: "When it really kicked off, e.g. 9pm, sat 7pm, yesterday 8:30pm, 2h ago", required: true },
      { type: INTEGER, name: "week", description: "Week 1-18 (19 Wild Card … 22 Super Bowl); default: the team's latest finished game", required: false, min_value: 1, max_value: 22 },
      { type: STRING, name: "timezone", description: "Time zone you typed the time in (default Eastern)", required: false, choices: [{ name: "Eastern", value: "ET" }, { name: "Central", value: "CT" }, { name: "Mountain", value: "MT" }, { name: "Pacific", value: "PT" }] },
    ],
  },
  {
    name: "kickoff",
    description: "Set when betting closes on your game this week (its kickoff); leave time empty to see this week's",
    ...SERVER_ONLY,
    options: [
      team(false),
      { type: STRING, name: "time", description: "e.g. 9pm, tomorrow 8:30pm, sat 7pm, in 45m, now", required: false },
      { type: STRING, name: "timezone", description: "Time zone you typed the time in (default Eastern)", required: false, choices: [{ name: "Eastern", value: "ET" }, { name: "Central", value: "CT" }, { name: "Mountain", value: "MT" }, { name: "Pacific", value: "PT" }] },
    ],
  },
];
