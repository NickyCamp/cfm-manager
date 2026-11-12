// Registers the bot's slash commands (src/lib/discord/commands.ts) with Discord.
// Run by .github/workflows/discord-commands.yml; needs DISCORD_BOT_TOKEN.
// Global commands: every server the bot is in gets them (can take a few minutes to show).
import { COMMANDS } from "../../src/lib/discord/commands";

const token = process.env.DISCORD_BOT_TOKEN;
if (!token) { console.error("DISCORD_BOT_TOKEN is not set."); process.exit(1); }
const auth = { authorization: `Bot ${token}`, "content-type": "application/json" };

(async () => {
  const me = await fetch("https://discord.com/api/v10/applications/@me", { headers: auth });
  if (!me.ok) { console.error("Couldn't read the application (is the token right?)", me.status, await me.text()); process.exit(1); }
  const app = (await me.json()) as { id: string; name: string };
  const res = await fetch(`https://discord.com/api/v10/applications/${app.id}/commands`, { method: "PUT", headers: auth, body: JSON.stringify(COMMANDS) });
  if (!res.ok) { console.error("Registering failed", res.status, await res.text()); process.exit(1); }
  const list = (await res.json()) as { name: string }[];
  console.log(`Registered ${list.length} commands for ${app.name} (${app.id}): ${list.map((c) => "/" + c.name).join(", ")}`);
  console.log(`Invite link: https://discord.com/oauth2/authorize?client_id=${app.id}&scope=bot+applications.commands&permissions=19456`);
})();
