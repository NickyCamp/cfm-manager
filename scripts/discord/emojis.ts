// Uploads the dev trait icons (public/dev/*.png) as the bot's application emojis, so Discord replies can
// show them (src/lib/discord/devEmoji.ts). Run by .github/workflows/discord-commands.yml; needs DISCORD_BOT_TOKEN.
// An emoji that already exists is replaced only when FORCE_EMOJIS=1 (e.g. after changing the art).
import fs from "node:fs";
import path from "node:path";
import { DEV_EMOJI_FILES, DEV_EMOJI_NAMES } from "../../src/lib/discord/devEmoji";

const fail = (msg: string) => { console.log(`::error::${msg.replace(/\n/g, " ")}`); process.exit(1); };
const token = process.env.DISCORD_BOT_TOKEN?.trim();
if (!token) fail("DISCORD_BOT_TOKEN is not set.");
const auth = { authorization: `Bot ${token}`, "content-type": "application/json" };
const API = "https://discord.com/api/v10";
const force = process.env.FORCE_EMOJIS === "1";

(async () => {
  const me = await fetch(`${API}/applications/@me`, { headers: auth });
  if (!me.ok) fail(`Couldn't read the application ${me.status}`);
  const app = ((await me.json()) as { id: string }).id;
  const list = await fetch(`${API}/applications/${app}/emojis`, { headers: auth });
  if (!list.ok) fail(`Couldn't list emojis ${list.status} ${(await list.text()).slice(0, 300)}`);
  const { items } = (await list.json()) as { items: { id: string; name: string }[] };
  const done: string[] = [];
  for (let k = 0; k < DEV_EMOJI_NAMES.length; k++) {
    const name = DEV_EMOJI_NAMES[k];
    const have = items.find((e) => e.name === name);
    if (have && !force) continue;
    if (have) await fetch(`${API}/applications/${app}/emojis/${have.id}`, { method: "DELETE", headers: auth });
    const png = fs.readFileSync(path.join(__dirname, "../../public/dev", `${DEV_EMOJI_FILES[k]}.png`));
    const res = await fetch(`${API}/applications/${app}/emojis`, {
      method: "POST", headers: auth,
      body: JSON.stringify({ name, image: `data:image/png;base64,${png.toString("base64")}` }),
    });
    if (!res.ok) fail(`Uploading ${name} failed ${res.status} ${(await res.text()).slice(0, 300)}`);
    done.push(name);
  }
  console.log(`::notice::Dev emojis: ${done.length ? `uploaded ${done.join(", ")}` : "all already there"}`);
})();
