import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { updateLeagueSettings } from "@/lib/leagueSettings";
import { forgetLeagueData, getLeagueData } from "@/lib/league/load";
import { awardDef, LEGACY_AWARD_KEYS, legacyAwardWinners, marketBook } from "@/lib/league/markets";
import { correctAwardBets, isCommissioner, memberNames, setCloseTime, settleFinished, verifyKickoff, viewer } from "@/lib/marketStore";
import { bookKey, ticketsConfig } from "@/lib/tickets";
import { postPayoutsNow, rebuildMarketChannels, refreshForMarket, refreshGame, syncMarketChannels } from "@/lib/discord/marketChannels";
import { removeGameChannels, syncGameChannels } from "@/lib/discord/gameChannels";
import { leagueBySlug } from "@/lib/discord/links";
import { auditRulesOf, parseAbilityRules, parsePositionRules, type AuditRules } from "@/lib/league/audit";

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
    const r = await updateLeagueSettings(v.leagueId!, (settings) => {
      settings[key] = { ...((settings[key] as Record<string, unknown>) || {}), ...patch };
      return settings;
    });
    return r.ok ? undefined : r.error;
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
    case "award": {
      // Madden's award winner (Nick, 2026-11-16: the formula's winners didn't match the game's)
      const d0 = await getLeagueData(slug);
      if (!d0) return fail("No league data yet.");
      const key = String(b.market || "");
      const winner = b.winner == null || b.winner === "" ? null : String(b.winner);
      const title = key === "award-coy" ? "Coach of the Year" : awardDef(d0, key)?.fullTitle;
      if (!title) return fail("Pick an award.");
      if (winner && (key === "award-coy" ? !d0.teams.some((t) => String(t.id) === winner) : !d0.players.some((p) => String(p.id) === winner))) return fail(`Pick the ${key === "award-coy" ? "team" : "player"} who won it.`);
      const year = String(d0.season.year);
      const saved = await updateLeagueSettings(v.leagueId, (settings) => {
        const awards = { ...((settings.awards as Record<string, Record<string, string>>) || {}) };
        const season = { ...(awards[year] || {}) };
        if (winner) season[key] = winner; else delete season[key];
        awards[year] = season;
        settings.awards = awards;
        return settings;
      });
      if (!saved.ok) return fail(saved.error || "Couldn't save that.", 500);
      forgetLeagueData(slug);
      if (!winner) return ok(`${title}: winner cleared. Bets that already settled stay as they were; pick the right winner to correct them.`);

      const d = await getLeagueData(slug);
      if (!d) return ok(`${title} saved.`);
      const tickets = Boolean(await ticketsConfig(slug).catch(() => null));
      const bk = bookKey(d.season.year, tickets);
      const by = `${me} (site)`;
      // bets that already settled on a different winner (the old formula, or an earlier pick)
      const fix = await correctAwardBets({ leagueId: v.leagueId, book: bk, market: key, winners: new Set([winner]), tickets, title, by });
      // league-wide OPOY/DPOY/OROY/DROY bets from before the conference split
      for (const lk of LEGACY_AWARD_KEYS) {
        if (!key.startsWith(`${lk}-`)) continue;
        const w = legacyAwardWinners(d, lk);
        if (!w) continue;
        const f2 = await correctAwardBets({ leagueId: v.leagueId, book: bk, market: lk, winners: w, tickets, title: `${title.replace(/^[A-Z]+ /, "")} (league-wide bet)`, by });
        fix.fixed += f2.fixed; fix.stuck += f2.stuck; f2.users.forEach((u) => fix.users.add(u));
      }
      const settled = await settleFinished(v.leagueId, bk, d, marketBook(d), tickets);
      await refreshForMarket(slug, key).catch(() => {});
      const parts = [`${title} saved: the market settles on Madden's winner.`];
      if (settled) parts.push(`${settled} open bet${settled === 1 ? "" : "s"} settled.`);
      if (fix.fixed) parts.push(`${fix.fixed} bet${fix.fixed === 1 ? "" : "s"} that had settled on a different winner ${fix.fixed === 1 ? "was" : "were"} corrected (${fix.users.size} member${fix.users.size === 1 ? "" : "s"})${tickets ? "; the corrections go in the next payouts report" : ""}.`);
      if (fix.stuck) parts.push(`⚠️ ${fix.stuck} bet${fix.stuck === 1 ? " was" : "s were"} already corrected once and need${fix.stuck === 1 ? "s" : ""} fixing by hand.`);
      return ok(parts.join(" "));
    }
    case "audit": {
      // Rule audits (/l/<slug>/admin/audit, /audit in Discord): the league's rules
      if (b.reset) {
        const r = await updateLeagueSettings(v.leagueId, (settings) => { delete settings.audit; return settings; });
        return r.ok ? ok("Default rules put back.") : fail(r.error || "Couldn't save that.", 500);
      }
      const r = b.rules as Partial<AuditRules> | undefined;
      const str = (x: unknown, max = 8000) => (typeof x === "string" ? x.slice(0, max) : undefined);
      const n = (x: unknown, lo: number, hi: number) => (typeof x === "number" && Number.isFinite(x) && x >= lo && x <= hi ? x : undefined);
      const cur = auditRulesOf((await leagueBySlug(slug))?.settings);
      const next: AuditRules = {
        abilities: { banned: str(r?.abilities?.banned) ?? cur.abilities.banned, limited: str(r?.abilities?.limited) ?? cur.abilities.limited },
        positions: {
          changes: str(r?.positions?.changes) ?? cur.positions.changes,
          lastWeek: n(r?.positions?.lastWeek, 0, 18) ?? cur.positions.lastWeek,
          eliteOnce: typeof r?.positions?.eliteOnce === "boolean" ? r.positions.eliteOnce : cur.positions.eliteOnce,
        },
        games: {
          gameCatches: n(r?.games?.gameCatches, 1, 50) ?? cur.games.gameCatches,
          gameShare: n(r?.games?.gameShare, 0.01, 1) ?? cur.games.gameShare,
          seasonShare: n(r?.games?.seasonShare, 0.01, 1) ?? cur.games.seasonShare,
          passTdShare: n(r?.games?.passTdShare, 0.01, 1) ?? cur.games.passTdShare,
          includeUnknown: typeof r?.games?.includeUnknown === "boolean" ? r.games.includeUnknown : cur.games.includeUnknown,
          includePlayoffs: typeof r?.games?.includePlayoffs === "boolean" ? r.games.includePlayoffs : cur.games.includePlayoffs,
        },
      };
      const saved = await updateLeagueSettings(v.leagueId, (settings) => { settings.audit = next; return settings; });
      if (!saved.ok) return fail(saved.error || "Couldn't save that.", 500);
      const errs = [...parseAbilityRules(next.abilities).errors, ...parsePositionRules(next.positions.changes).errors];
      return ok(errs.length ? `Saved, but some lines couldn't be read: ${errs.join("; ")}` : "Rules saved. /audit uses them right away.");
    }
    case "payouts": return ok(await postPayoutsNow(slug));
    case "marketchannels": return ok(await rebuildMarketChannels(slug));
    case "marketupdate": return ok(await syncMarketChannels(slug));
    case "gamechannels": return ok(b.remove ? await removeGameChannels(slug, { week: num(b.week) }) : await syncGameChannels(slug, { week: num(b.week) }));
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
