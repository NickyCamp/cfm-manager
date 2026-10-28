// When to start a league sync, besides the GitHub schedule (which GitHub runs
// late or skips):
// - on visit: someone opens a league page and it hasn't been checked or
//   requested in VISIT_STALE_MS ("auto": only pulls from EA if the league moved)
// - "Sync now": a league member asks, at most once per MANUAL_COOLDOWN_MS (full pull)
// - daily Vercel cron (/api/cron/sync): every league, "auto"
// The last request time lives in leagues.settings.syncRequestedAt, claimed with
// a conditional update so a burst of visitors starts one run, not many.
import { supabaseAdmin } from "@/lib/supabase/server";
import { dispatchConfigured, triggerSync } from "@/lib/dispatch";

export const VISIT_STALE_MS = 2 * 3600_000;
export const MANUAL_COOLDOWN_MS = 15 * 60_000;

export type SyncRequest = { started: boolean; reason?: "not-configured" | "recent" | "failed" | "no-league"; nextAt?: number };

export async function requestSync(slug: string, opts: { minGapMs: number; mode: "auto" | "full"; by: string }): Promise<SyncRequest> {
  if (!dispatchConfigured()) return { started: false, reason: "not-configured" };
  const admin = supabaseAdmin();
  const { data: lg } = await admin.from("leagues").select("id, settings").eq("slug", slug).maybeSingle();
  if (!lg) return { started: false, reason: "no-league" };
  const settings = (lg.settings || {}) as Record<string, unknown>;
  const prev = typeof settings.syncRequestedAt === "string" ? settings.syncRequestedAt : null;
  const { data: run } = await admin.from("sync_runs").select("started_at").eq("league_id", lg.id).order("started_at", { ascending: false }).limit(1).maybeSingle();
  const last = Math.max(prev ? Date.parse(prev) : 0, run?.started_at ? Date.parse(run.started_at) : 0);
  const now = Date.now();
  if (now - last < opts.minGapMs) return { started: false, reason: "recent", nextAt: last + opts.minGapMs };

  // Claim the request: only succeeds if nobody else updated it since we read it.
  let claim = admin.from("leagues").update({ settings: { ...settings, syncRequestedAt: new Date(now).toISOString(), syncRequestedBy: opts.by } }).eq("id", lg.id);
  claim = prev ? claim.filter("settings->>syncRequestedAt", "eq", prev) : claim.is("settings->>syncRequestedAt", null);
  const { data: claimed } = await claim.select("id");
  if (!claimed?.length) return { started: false, reason: "recent", nextAt: now + opts.minGapMs };

  const ok = await triggerSync(slug, opts.mode);
  return ok ? { started: true } : { started: false, reason: "failed" };
}
