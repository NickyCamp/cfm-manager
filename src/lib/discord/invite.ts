// Adding the CFM Manager bot to a Discord server (Nick, 2026-11-14: a button on the site to invite the bot).
// Permissions 268487696 = View Channels, Send Messages, Embed Links, Attach Files, Manage Channels
// (weekly game / Markets channels) and Manage Roles (making the Markets channels bot-only).
export const BOT_CLIENT_ID = "1570587209743073343";
export const BOT_INVITE_URL = `https://discord.com/oauth2/authorize?client_id=${BOT_CLIENT_ID}&scope=bot+applications.commands&permissions=268487696`;
