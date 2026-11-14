// Who counts as a league admin in Discord (Nick, 2026-11-14): anyone with the server's own role
// named "admin" (any capitalization). Not Discord's Administrator permission. If a server has no
// role by that name yet, its Administrators count instead, so a new league isn't locked out.
// Used for /league, /marketchannels, /marketupdate, /gamechannels, /payouts, /verifykickoff,
// the payouts Applied button and changing a kickoff after it has passed.
import { dc } from "./rest";

const cache = new Map<string, { at: number; ids: string[] | null }>();

/** Ids of the server's roles named "admin" (null = the server has none). Cached 5 minutes. */
async function adminRoleIds(guildId: string): Promise<string[] | null> {
  const hit = cache.get(guildId);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.ids;
  const r = await dc("GET", `/guilds/${guildId}/roles`);
  if (!r.ok || !Array.isArray(r.data)) return hit?.ids ?? null;
  const ids = (r.data as { id: string; name: string }[]).filter((x) => x.name.trim().toLowerCase() === "admin").map((x) => x.id);
  const out = ids.length ? ids : null;
  cache.set(guildId, { at: Date.now(), ids: out });
  return out;
}

export type AdminCheckable = { guild_id?: string; member?: { roles?: string[]; permissions?: string } };

export async function isLeagueAdmin(i: AdminCheckable): Promise<boolean> {
  if (!i.guild_id || !i.member) return false;
  const ids = await adminRoleIds(i.guild_id).catch(() => null);
  if (ids) return (i.member.roles || []).some((r) => ids.includes(r));
  return (BigInt(i.member.permissions || "0") & BigInt(1 << 3)) !== BigInt(0);
}

export const NOT_ADMIN = "Only people with the server's **admin** role can do that.";
