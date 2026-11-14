// League Tickets through UnbelievaBoat (Nick, 2026-11-13). UnbelievaBoat is the bank.
// Since 2026-11-14 the site only READS balances: bets record a stake, results go in
// market_ledger (supabase/migrations/0006), and admins add/remove Tickets by hand from
// the weekly "Previous Week Payouts" report the bot posts (src/lib/discord/payouts.ts).
//
// Settings:
//   UNBELIEVABOAT_TOKEN  (Vercel) API token from unbelievaboat.com/applications; it works in every
//                        server where a server admin opened UB_AUTHORIZE_URL and picked that server
//   leagues.settings.tickets = { enabled, field }  per league, set by its commissioner on
//                        /l/<slug>/markets/setup ("cash" or "bank": which balance holds Tickets)
//   TICKETS_LEAGUES / TICKETS_BALANCE  (Vercel, older) used only for leagues with no setting of their own
// The league's Discord server is the one linked with the bot's /link.
import { createHmac, timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/server";
import { discordOf, leagueBySlug } from "@/lib/discord/links";

export const TICKETS_PER_CONTRACT = 100;
const UB = "https://unbelievaboat.com/api/v1";

export type TicketsConfig = { guildId: string; field: "cash" | "bank" };

/** UnbelievaBoat's page for letting CFM Manager read balances in a server (needs Discord Administrator there). */
export const UB_AUTHORIZE_URL = `https://unbelievaboat.com/applications/authorize?app_id=${process.env.UNBELIEVABOAT_APP_ID || "1570965539797468846"}`;
export type TicketsSetting = { enabled?: boolean; field?: "cash" | "bank" };

/** Tickets settings for a league, or null if it bets play money. A commissioner turns Tickets on for
 *  their league on the Markets setup page (leagues.settings.tickets); TICKETS_LEAGUES is the older
 *  env switch and still works when the league has no setting of its own. */
export async function ticketsConfig(slug: string): Promise<TicketsConfig | null> {
  if (!process.env.UNBELIEVABOAT_TOKEN) return null;
  const lg = await leagueBySlug(slug);
  if (!lg) return null;
  const own = (lg.settings?.tickets || null) as TicketsSetting | null;
  const envOn = (process.env.TICKETS_LEAGUES || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean).includes(slug.toLowerCase());
  if (!(own?.enabled ?? envOn)) return null;
  const guildId = discordOf(lg)?.guildId;
  if (!guildId) return null;
  const field = own?.field ?? (process.env.TICKETS_BALANCE === "bank" ? "bank" : "cash");
  return { guildId, field };
}

/** Which book a league's trades go in: play money keeps the season number, Tickets use season*10+1. */
export const bookKey = (season: number, tickets: boolean) => (tickets ? season * 10 + 1 : season);

async function ub(path: string, init?: RequestInit) {
  const res = await fetch(`${UB}${path}`, {
    ...init,
    headers: { Authorization: process.env.UNBELIEVABOAT_TOKEN || "", "content-type": "application/json", ...(init?.headers || {}) },
    cache: "no-store",
  });
  const text = await res.text();
  let j: Record<string, unknown> = {};
  try { j = JSON.parse(text); } catch { /* not JSON */ }
  if (!res.ok) throw new Error(`UnbelievaBoat ${res.status}: ${String(j.message || text).slice(0, 160)}`);
  return j;
}
/** A member's Tickets in the configured balance. */
export async function ticketBalance(cfg: TicketsConfig, discordId: string): Promise<number> {
  const j = await ub(`/guilds/${cfg.guildId}/users/${discordId}`);
  return Number(j[cfg.field] ?? 0);
}
// ---------------------------------------------------------------- Discord account links
// /connect in Discord hands out a signed link (valid 15 minutes) that ties the
// Discord account to whoever confirms it on the site. Stored in the site user's
// app_metadata (discord_id, discord_name), which only the server can write.

function linkKey() {
  const base = process.env.EA_TOKEN_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  return createHmac("sha256", base).update("cfm-discord-link-v1").digest();
}
export function makeLinkToken(discordId: string, name: string) {
  const body = Buffer.from(JSON.stringify({ d: discordId, n: name.slice(0, 40), e: Date.now() + 15 * 60_000 })).toString("base64url");
  const sig = createHmac("sha256", linkKey()).update(body).digest("base64url");
  return `${body}.${sig}`;
}
export function readLinkToken(token: string): { discordId: string; name: string } | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const want = createHmac("sha256", linkKey()).update(body).digest();
  const got = Buffer.from(sig, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (typeof p.d !== "string" || !/^\d{15,22}$/.test(p.d) || Date.now() > Number(p.e)) return null;
    return { discordId: p.d, name: String(p.n || "") };
  } catch { return null; }
}
/** A site user's linked Discord account. Kept in app_metadata, which only the server can write
 *  (user_metadata can be changed by the user themselves with the public key). */
export async function discordOfUser(userId: string): Promise<{ id: string; name: string } | null> {
  const { data } = await supabaseAdmin().auth.admin.getUserById(userId);
  const m = data.user?.app_metadata as Record<string, unknown> | undefined;
  return m?.discord_id ? { id: String(m.discord_id), name: String(m.discord_name || "") } : null;
}
/** Every site user, a page at a time (small leagues: a few hundred users at most). */
async function allUsers() {
  const admin = supabaseAdmin();
  const out: { id: string; app_metadata: Record<string, unknown> }[] = [];
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error || !data.users.length) break;
    out.push(...data.users.map((u) => ({ id: u.id, app_metadata: (u.app_metadata || {}) as Record<string, unknown> })));
    if (data.users.length < 200) break;
  }
  return out;
}
/** Links a Discord account to one site user; any other site user linked to it is unlinked. */
export async function linkDiscord(userId: string, discordId: string, name: string) {
  byDiscord.clear();
  const admin = supabaseAdmin();
  for (const u of await allUsers()) {
    if (u.id !== userId && String(u.app_metadata.discord_id || "") === discordId) {
      const { discord_id: _a, discord_name: _b, ...rest } = u.app_metadata; void _a; void _b;
      await admin.auth.admin.updateUserById(u.id, { app_metadata: { ...rest, discord_id: null, discord_name: null } });
    }
  }
  const { data } = await admin.auth.admin.getUserById(userId);
  const meta = { ...(data.user?.app_metadata || {}), discord_id: discordId, discord_name: name };
  const { error } = await admin.auth.admin.updateUserById(userId, { app_metadata: meta });
  if (error) throw new Error(error.message);
}

const byDiscord = new Map<string, { at: number; userId: string | null }>();
/** The site user linked to a Discord account (via /connect), cached 5 minutes. */
export async function userForDiscord(discordId: string): Promise<string | null> {
  const hit = byDiscord.get(discordId);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.userId;
  let found: string | null = null;
  for (const u of await allUsers()) {
    const id = u.app_metadata.discord_id;
    if (id) byDiscord.set(String(id), { at: Date.now(), userId: u.id });
    if (id && String(id) === discordId) found = u.id;
  }
  byDiscord.set(discordId, { at: Date.now(), userId: found });
  return found;
}
