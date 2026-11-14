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
    });
    const text = await res.text();
    let data: Record<string, unknown> = {};
    try { data = text ? JSON.parse(text) : {}; } catch { /* empty */ }
    if (res.status === 429) { await sleep(Math.ceil(Number(data.retry_after || 1) * 1000) + 100); continue; }
    return { ok: res.ok, status: res.status, data };
  }
  return { ok: false, status: 429, data: { message: "rate limited" } };
}

