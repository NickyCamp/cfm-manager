// Adding the CFM Manager bot to a Discord server (Nick, 2026-11-14: a button on the site to invite the bot).
// Permissions 378225806352 = View Channels, Send Messages, Embed Links, Attach Files, Manage Channels
// (weekly game / Markets channels), Manage Roles (making channels bot-only), plus Read Message History,
// Mention Everyone (team-role pings) and the three thread permissions: Discord refuses a channel
// overwrite that allows or denies a permission the bot doesn't hold itself (2026-11-18).
export const BOT_CLIENT_ID = "1570587209743073343";
export const BOT_INVITE_URL = `https://discord.com/oauth2/authorize?client_id=${BOT_CLIENT_ID}&scope=bot+applications.commands&permissions=378225806352`;
