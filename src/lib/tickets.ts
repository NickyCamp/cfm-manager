// League Tickets through UnbelievaBoat (Nick, 2026-11-13). UnbelievaBoat is the
// bank: the site takes Tickets for bets and pays sales and winnings back, and
// records every movement in market_ticket_moves (supabase/migrations/0004).
//
// Settings (Vercel env):
//   UNBELIEVABOAT_TOKEN  API token from unbelievaboat.com/applications, authorized for the league's server
//   TICKETS_LEAGUES      comma-separated league slugs that bet in Tickets, e.g. "ncl"
//   TICKETS_BALANCE      "cash" (default) or "bank": which UnbelievaBoat balance holds Tickets
// The league's Discord server is the one linked with the bot's /link.
import { createHmac, timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/server";
import { discordOf, leagueBySlug } from "@/lib/discord/links";

export const TICKETS_PER_CONTRACT = 100;
const UB = "https://unbelievaboat.com/api/v1";

export type TicketsConfig = { guildId: string; field: "cash" | "bank" };

/** Tickets settings for a league, or null if it bets play money. */
export async function ticketsConfig(slug: string): Promise<TicketsConfig | null> {
  if (!process.env.UNBELIEVABOAT_TOKEN) return null;
  const on = (process.env.TICKETS_LEAGUES || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!on.includes(slug.toLowerCase())) return null;
  const lg = await leagueBySlug(slug);
  const guildId = lg ? discordOf(lg)?.guildId : null;
  if (!guildId) return null;
  return { guildId, field: process.env.TICKETS_BALANCE === "bank" ? "bank" : "cash" };
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
/** Adds (or with a negative amount, takes) Tickets. */
export async function moveTickets(cfg: TicketsConfig, discordId: string, amount: number, reason: string) {
  return ub(`/guilds/${cfg.guildId}/users/${discordId}`, { method: "PATCH", body: JSON.stringify({ [cfg.field]: Math.round(amount), reason: reason.slice(0, 200) }) });
}

// ---------------------------------------------------------------- Discord account links
// /connect in Discord hands out a signed link (valid 15 minutes) that ties the
// Discord account to whoever confirms it on the site. Stored in the site user's
// auth metadata (discord_id, discord_name), so no extra table.

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
export async function discordOfUser(userId: string): Promise<{ id: string; name: string } | null> {
  const { data } = await supabaseAdmin().auth.admin.getUserById(userId);
  const m = data.user?.user_metadata as Record<string, unknown> | undefined;
  return m?.discord_id ? { id: String(m.discord_id), name: String(m.discord_name || "") } : null;
}
export async function linkDiscord(userId: string, discordId: string, name: string) {
  byDiscordForget(discordId);
  const admin = supabaseAdmin();
  const { data } = await admin.auth.admin.getUserById(userId);
  const meta = { ...(data.user?.user_metadata || {}), discord_id: discordId, discord_name: name };
  const { error } = await admin.auth.admin.updateUserById(userId, { user_metadata: meta });
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------- payouts
/** Sends queued Ticket payments (sales, winnings, refunds). Each row is claimed first so it's never paid twice. */
export async function sendPendingTickets(leagueId: string, cfg: TicketsConfig, limit = 40) {
  const admin = supabaseAdmin();
  const { data } = await admin.from("market_ticket_moves").select("id, user_id, amount, reason")
    .eq("league_id", leagueId).eq("status", "pending").order("id").limit(limit);
  let sent = 0;
  const discordIds = new Map<string, { id: string } | null>();
  for (const row of data || []) {
    if (!discordIds.has(row.user_id)) discordIds.set(row.user_id, await discordOfUser(row.user_id).catch(() => null));
    const d = discordIds.get(row.user_id);
    if (!d) { await admin.from("market_ticket_moves").update({ error: "Discord not linked yet (/connect)" }).eq("id", row.id).eq("status", "pending"); continue; }
    const { data: claimed } = await admin.from("market_ticket_moves").update({ status: "sending" }).eq("id", row.id).eq("status", "pending").select("id");
    if (!claimed?.length) continue;
    try {
      await moveTickets(cfg, d.id, Number(row.amount), row.reason);
      await admin.from("market_ticket_moves").update({ status: "done", done_at: new Date().toISOString(), error: null }).eq("id", row.id);
      sent++;
    } catch (e) {
      // Not sent: back in the queue for the next try.
      await admin.from("market_ticket_moves").update({ status: "pending", error: (e as Error).message.slice(0, 200) }).eq("id", row.id);
    }
  }
  return sent;
}

const byDiscord = new Map<string, { at: number; userId: string | null }>();
function byDiscordForget(id: string) { byDiscord.delete(id); }
/** The site user linked to a Discord account (via /connect), cached 5 minutes. */
export async function userForDiscord(discordId: string): Promise<string | null> {
  const hit = byDiscord.get(discordId);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.userId;
  const admin = supabaseAdmin();
  let found: string | null = null;
  for (let page = 1; page <= 20 && !found; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error || !data.users.length) break;
    for (const u of data.users) {
      const id = (u.user_metadata as Record<string, unknown> | undefined)?.discord_id;
      if (id) byDiscord.set(String(id), { at: Date.now(), userId: u.id });
      if (String(id) === discordId) found = u.id;
    }
    if (data.users.length < 200) break;
  }
  byDiscord.set(discordId, { at: Date.now(), userId: found });
  return found;
}
