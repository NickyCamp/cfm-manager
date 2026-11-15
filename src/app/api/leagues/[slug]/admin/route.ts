import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getLeagueData } from "@/lib/league/load";
import { marketBook } from "@/lib/league/markets";
import { isCommissioner, memberNames, setCloseTime, verifyKickoff, viewer } from "@/lib/marketStore";
import { ticketsConfig } from "@/lib/tickets";
import { postPayoutsNow, rebuildMarketChannels, refreshGame, syncMarketChannels } from "@/lib/discord/marketChannels";
import { removeGameChannels, syncGameChannels } from "@/lib/discord/gameChannels";

// The site's admin panel (/l/<slug>/admin, Nick 2026-11-14): everything the Discord admin commands do,
// for the league's commissioner or owner. POST { action, ... }.
export const maxDuration = 300; // rebuilding the Discord channels can take a couple of minutes

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const v = await viewer(slug);
  if (!v.userId) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!v.leagueId || !(await isCommissioner(v.leagueId, v.userId))) return NextResponse.json({ error: "Only the league's commissioner can do that." }, { status: 403 });
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || typeof b.action !== "string") return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const db = supabaseAdmin();
  const me = (await memberNames([v.userId])).get(v.userId) || "Commissioner";
  const ok = (text: string) => NextResponse.json({ ok: true, text });
  const fail = (error: string, status = 400) => NextResponse.json({ error }, { status });
  const num = (x: unknown) => (x === "" || x == null ? undefined : Number(x));

  const saveSetting = async (key: string, patch: Record<string, unknown>) => {
    const { data } = await db.from("leagues").select("settings").eq("id", v.leagueId!).single();
    const settings = { ...((data?.settings as Record<string, unknown>) || {}) };
    settings[key] = { ...((settings[key] as Record<string, unknown>) || {}), ...patch };
    const { error } = await db.from("leagues").update({ settings }).eq("id", v.leagueId!);
    return error?.message;
  };

  switch (b.action) {
    case "betcaps": {
      const perBet = num(b.perBet), perUser = num(b.perUser);
      if ([perBet, perUser].some((x) => x !== undefined && !(x >= 0))) return fail("Caps must be 0 or more.");
      const patch: Record<string, unknown> = {};
      if (perBet !== undefined) patch.perBet = perBet || null;
      if (perUser !== undefined) patch.perUserWeek = perUser || null;
      const e = await saveSetting("betCaps", patch);
      return e ? fail(e, 500) : ok("Bet caps saved.");
    }
    case "economy": {
      const cut = num(b.cut), floor = num(b.floor), fee = num(b.cashoutFee);
      if ([cut, fee].some((x) => x !== undefined && !(x >= 0 && x <= 50)) || (floor !== undefined && !(floor >= 0 && floor <= 20))) return fail("Cut and fee must be 0–50%, the lowest price 0–20%.");
      const patch: Record<string, unknown> = {};
      if (cut !== undefined) patch.cut = cut / 100;
      if (floor !== undefined) patch.floor = floor / 100;
      if (fee !== undefined) patch.cashoutFee = fee / 100;
      const e = await saveSetting("economy", patch);
      return e ? fail(e, 500) : ok("House rules saved.");
    }
    case "apply":
    case "undo": {
      const ids = Array.isArray(b.ids) ? (b.ids as unknown[]).map(Number).filter((x) => x > 0) : [];
      if (!ids.length) return fail("Nothing to change.");
      let q = db.from("market_ledger").update(b.action === "apply" ? { applied_at: new Date().toISOString(), applied_by: `${me} (site)`.slice(0, 64) } : { applied_at: null, applied_by: null })
        .eq("league_id", v.leagueId).in("id", ids);
      q = b.action === "apply" ? q.is("applied_at", null) : q.not("applied_at", "is", null);
      const { error } = await q;
      return error ? fail(error.message, 500) : ok(b.action === "apply" ? "Marked applied." : "Marked not applied.");
    }
    case "payouts": return ok(await postPayoutsNow(slug));
    case "marketchannels": return ok(await rebuildMarketChannels(slug));
    case "marketupdate": return ok(await syncMarketChannels(slug));
    case "gamechannels": return ok(b.remove ? await removeGameChannels(slug) : await syncGameChannels(slug, { week: num(b.week) }));
    case "kickoff":
    case "verify": {
      const d = await getLeagueData(slug);
      if (!d) return fail("No league data yet.");
      const gameId = Number(b.gameId), when = new Date(String(b.at || ""));
      if (!d.games.some((g) => g.id === gameId)) return fail("Pick a game.");
      if (Number.isNaN(when.getTime())) return fail("Pick a date and time.");
      if (b.action === "kickoff") {
        try { await setCloseTime(v.leagueId, d.season.year, gameId, when, { kind: "site", id: v.userId, name: me }); }
        catch (e) { return fail((e as Error).message, 500); }
        await refreshGame(slug, gameId).catch(() => {});
        return ok("Kickoff saved.");
      }
      if (when.getTime() > Date.now()) return fail("A verified kickoff has to be in the past.");
      const tickets = Boolean(await ticketsConfig(slug).catch(() => null));
      const r = await verifyKickoff({ leagueId: v.leagueId, season: d.season.year, d, book: marketBook(d), gameId, kickoff: when, tickets, by: { kind: "site", id: v.userId, name: me } });
      if (!r.ok) return fail(r.error);
      return ok(r.voided.length ? `Kickoff verified. Voided ${r.voided.length} bet${r.voided.length === 1 ? "" : "s"} placed after it; the corrections go in the next payouts report.` : "Kickoff verified. No bets were placed after it.");
    }
  }
  return fail("Unknown action.");
}
