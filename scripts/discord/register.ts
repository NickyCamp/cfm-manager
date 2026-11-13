// Registers the bot's slash commands (src/lib/discord/commands.ts) with Discord.
// Run by .github/workflows/discord-commands.yml; needs DISCORD_BOT_TOKEN.
// Global commands: every server the bot is in gets them (can take a few minutes to show).
import { COMMANDS } from "../../src/lib/discord/commands";

// "::error::" / "::notice::" lines show up as annotations on the Actions run page.
const fail = (msg: string) => { console.log(`::error::${msg.replace(/\n/g, " ")}`); process.exit(1); };
const token = process.env.DISCORD_BOT_TOKEN?.trim();
if (!token) fail("DISCORD_BOT_TOKEN is not set. Add it under Settings > Secrets and variables > Actions.");
const auth = { authorization: `Bot ${token}`, "content-type": "application/json" };

(async () => {
  const me = await fetch("https://discord.com/api/v10/applications/@me", { headers: auth });
  if (!me.ok) fail(`Couldn't read the application (is the token right?) ${me.status} ${(await me.text()).slice(0, 300)}`);
  const app = (await me.json()) as { id: string; name: string };
  const res = await fetch(`https://discord.com/api/v10/applications/${app.id}/commands`, { method: "PUT", headers: auth, body: JSON.stringify(COMMANDS) });
  if (!res.ok) fail(`Registering failed ${res.status} ${(await res.text()).slice(0, 600)}`);
  const list = (await res.json()) as { name: string }[];
  console.log(`::notice::Registered ${list.length} commands for ${app.name} (${app.id}): ${list.map((c) => "/" + c.name).join(", ")}`);
  console.log(`Invite link: https://discord.com/oauth2/authorize?client_id=${app.id}&scope=bot+applications.commands&permissions=19456`);
})();
