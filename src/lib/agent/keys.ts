// API keys for the agent API (Nick, 2026-11-24: "an API my friend can use to do a podcast with AI agents").
//
// A key belongs to one league and reads only that league. Keys are kept in leagues.settings.apiKeys as
// SHA-256 hashes (the key itself is shown once, when it's made), so no migration is needed and a leaked
// settings blob doesn't leak working keys. Format: cfm_<league slug>_<40 hex>; the slug in the key says
// which league's settings to check (slugs never contain "_").
//
// Rate limit: a simple per-key window per server instance. Not exact across Vercel instances, but enough
// to stop a runaway agent loop from hammering the site.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/server";
import { updateLeagueSettings } from "@/lib/leagueSettings";

export type ApiKeyRow = {
  id: string;          // short id shown in the admin list
  name: string;        // "Mike's podcast"
  hash: string;        // sha256 hex of the full key
  hint: string;        // last 4 characters, to tell keys apart
  createdAt: string;
  createdBy: string;   // user id
  revokedAt?: string;
};

export const KEY_RE = /^cfm_([a-z0-9][a-z0-9-]{1,38}[a-z0-9])_([0-9a-f]{40})$/;
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

export function newKey(slug: string) {
  const key = `cfm_${slug}_${randomBytes(20).toString("hex")}`;
  return { key, hash: sha(key), hint: key.slice(-4) };
}

export type KeyCheck = { ok: true; slug: string; leagueId: string; leagueName: string; keyId: string; keyName: string } | { ok: false; status: number; error: string };

const cache = new Map<string, { at: number; r: KeyCheck }>();
const CACHE_MS = 60_000;

/** Is this a live key? Returns the league it reads. Results are cached a minute (a revoke takes up to a minute). */
export async function checkKey(key: string | null | undefined): Promise<KeyCheck> {
  const k = (key || "").trim();
  const m = KEY_RE.exec(k);
  if (!m) return { ok: false, status: 401, error: "Missing or malformed API key. Ask the league's commissioner for one (league Admin → Agent API)." };
  const hash = sha(k);
  const hit = cache.get(hash);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.r;
  const { data: lg, error } = await supabaseAdmin().from("leagues").select("id, slug, name, settings").eq("slug", m[1]).maybeSingle();
  if (error) return { ok: false, status: 503, error: "Couldn't check the key right now; try again." };
  const rows = ((lg?.settings as { apiKeys?: ApiKeyRow[] } | null)?.apiKeys || []);
  const row = rows.find((r) => r.hash.length === hash.length && timingSafeEqual(Buffer.from(r.hash), Buffer.from(hash)));
  const r: KeyCheck = !lg || !row || row.revokedAt
    ? { ok: false, status: 401, error: "That API key isn't valid (revoked or never existed)." }
    : { ok: true, slug: lg.slug, leagueId: lg.id, leagueName: lg.name, keyId: row.id, keyName: row.name };
  cache.set(hash, { at: Date.now(), r });
  return r;
}

const windows = new Map<string, { start: number; n: number }>();
export const RATE_LIMIT = 120; // calls per minute per key (per server instance)
/** true when this call is over the limit */
export function overLimit(keyId: string) {
  const now = Date.now();
  const w = windows.get(keyId);
  if (!w || now - w.start > 60_000) { windows.set(keyId, { start: now, n: 1 }); return false; }
  w.n++;
  return w.n > RATE_LIMIT;
}

/** The key from an Authorization: Bearer header, an x-api-key header, or ?key= (for agent apps that only take a URL). */
export function keyFromRequest(req: Request, pathKey?: string) {
  if (pathKey) return pathKey;
  const auth = req.headers.get("authorization") || "";
  const bearer = /^Bearer\s+(\S+)/i.exec(auth)?.[1];
  return bearer || req.headers.get("x-api-key") || new URL(req.url).searchParams.get("key") || "";
}

// ---------- commissioner side ----------

export async function listKeys(leagueId: string): Promise<Omit<ApiKeyRow, "hash">[]> {
  const { data } = await supabaseAdmin().from("leagues").select("settings").eq("id", leagueId).maybeSingle();
  const rows = ((data?.settings as { apiKeys?: ApiKeyRow[] } | null)?.apiKeys || []);
  return rows.map(({ hash: _h, ...r }) => { void _h; return r; });
}

export async function createKey(leagueId: string, slug: string, name: string, userId: string) {
  const { key, hash, hint } = newKey(slug);
  const row: ApiKeyRow = { id: randomBytes(4).toString("hex"), name: name.trim().slice(0, 60) || "Agent key", hash, hint, createdAt: new Date().toISOString(), createdBy: userId };
  const r = await updateLeagueSettings(leagueId, (s) => {
    const list = Array.isArray(s.apiKeys) ? (s.apiKeys as ApiKeyRow[]) : [];
    if (list.filter((k) => !k.revokedAt).length >= 20) return null;
    s.apiKeys = [...list, row];
    return s;
  });
  if (!r.ok) return { ok: false as const, error: r.error || "Couldn't save the key." };
  if (!r.changed) return { ok: false as const, error: "This league already has 20 live keys; revoke one first." };
  return { ok: true as const, key, row: { ...row, hash: undefined } };
}

export async function revokeKey(leagueId: string, id: string) {
  const r = await updateLeagueSettings(leagueId, (s) => {
    const list = Array.isArray(s.apiKeys) ? (s.apiKeys as ApiKeyRow[]) : [];
    const k = list.find((x) => x.id === id);
    if (!k || k.revokedAt) return null;
    k.revokedAt = new Date().toISOString();
    s.apiKeys = list;
    return s;
  });
  cache.clear();
  return r.ok ? { ok: true as const } : { ok: false as const, error: r.error || "Couldn't revoke." };
}
