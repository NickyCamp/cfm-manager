// The bot's slash commands, as Discord's API wants them.
// .github/workflows/discord-commands.yml registers these with Discord whenever
// this file changes on main (scripts/discord/register.ts), so editing this list
// is all it takes to add or change a command.

const STRING = 3, CHANNEL = 7, INTEGER = 4;
const MANAGE_SERVER = String(1 << 5);

// Where a command can be used. Server setup commands need the bot added to the
// server; everything else also works when someone installs the bot to their own
// account (user install) — in DMs, group DMs and other servers.
const SERVER_ONLY = { integration_types: [0], contexts: [0] };
const ANYWHERE = { integration_types: [0, 1], contexts: [0, 1, 2] };

const player = { type: STRING, name: "player", description: "Start typing a name", required: true, autocomplete: true };
const team = (required: boolean) => ({ type: STRING, name: "team", description: "Start typing a team", required, autocomplete: true });

export const COMMANDS = [
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
    description: "Post league updates (advances, scores, moves) in a channel; leave empty to turn off",
    default_member_permissions: MANAGE_SERVER,
    ...SERVER_ONLY,
    options: [{ type: CHANNEL, name: "channel", description: "Where to post updates", required: false, channel_types: [0, 5] }],
  },
  {
    name: "myleague",
    description: "Set your own league, used in DMs, group DMs and servers that aren't linked",
    ...ANYWHERE,
    options: [{ type: STRING, name: "league", description: "The league's web address, e.g. ncl; leave empty to see or clear yours", required: false }],
  },
  { name: "player", description: "A player's ratings, contract and cap hit by year", ...ANYWHERE, options: [player] },
  { name: "contract", description: "What a player will likely ask for on his next deal", ...ANYWHERE, options: [player] },
  { name: "cap", description: "Cap space now and projected; pick a team for its breakdown", ...ANYWHERE, options: [team(false)] },
  { name: "team", description: "A team's record, cap space and best players", ...ANYWHERE, options: [team(true)] },
  { name: "tws", description: "A team's game this week: opponent and offense vs defense matchup with league ranks", ...ANYWHERE, options: [team(true)] },
  { name: "standings", description: "Division standings", ...ANYWHERE },
  { name: "playoffs", description: "Playoff picture with NFL tiebreakers", ...ANYWHERE },
  {
    name: "scores",
    description: "Scores for a week (default: the latest week with a final)",
    ...ANYWHERE,
    options: [{ type: INTEGER, name: "week", description: "Regular-season week number", required: false, min_value: 1, max_value: 18 }],
  },
  { name: "league", description: "Which league you're seeing here, with links", ...ANYWHERE },
];
