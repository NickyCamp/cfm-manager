// Discord REST calls as the bot (DISCORD_BOT_TOKEN), retried on rate limits.
const API = "https://discord.com/api/v10";
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function dc(method: string, path: string, body?: unknown): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) throw new Error("DISCORD_BOT_TOKEN isn't set on the site.");
  for (let i = 0; i < 4; i++) {
    const res = await fetch(`${API}${path}`, {
      method, headers: { authorization: `Bot ${token}`, "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000), // a hung call would otherwise hold the whole run until the function is killed
    });
    const text = await res.text();
    let data: Record<string, unknown> = {};
    try { data = text ? JSON.parse(text) : {}; } catch { /* empty */ }
    if (res.status === 429) { await sleep(Math.ceil(Number(data.retry_after || 1) * 1000) + 100); continue; }
    return { ok: res.ok, status: res.status, data };
  }
  return { ok: false, status: 429, data: { message: "rate limited" } };
}


type DcResult = { ok: boolean; status: number };
/** The channel or message really isn't there any more (deleted, or the bot can no longer see it).
 *  Anything else that isn't ok (rate limited after retries, a Discord outage) is "don't know": callers
 *  must not create a replacement on that, or every hiccup leaves a duplicate behind. */
export const isGone = (r: DcResult) => r.status === 404 || r.status === 403;

/** Does this channel still exist? Throws when Discord can't say (so a run stops instead of rebuilding). */
export async function channelGone(id: string): Promise<boolean> {
  const r = await dc("GET", `/channels/${id}`);
  if (r.ok) return false;
  if (isGone(r)) return true;
  throw new Error(`Discord didn't answer (${r.status}). Nothing was changed; try again in a minute.`);
}
