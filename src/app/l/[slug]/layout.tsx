import { notFound } from "next/navigation";
import { after } from "next/server";
import { currentUser, supabaseAdmin } from "@/lib/supabase/server";
import { dispatchConfigured } from "@/lib/dispatch";
import { requestSync, VISIT_STALE_MS } from "@/lib/sync";
import { SyncNowButton } from "@/components/league/SyncNowButton";
import { getLeagueData, getLeagueRow } from "@/lib/league/load";
import { LeagueNav, LeagueTools } from "@/components/league/LeagueNav";
import { syncStatusText } from "@/lib/format";
import { Toaster } from "@/components/league/Toaster";
import { canSeeCardArt } from "@/lib/cardArtStore";
import { isCommissioner } from "@/lib/marketStore";

export const dynamic = "force-dynamic";

export default async function LeagueLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const row = await getLeagueRow(slug);
  if (!row) notFound();
  const data = await getLeagueData(slug);

  // Someone's looking: if the league hasn't been checked in a while, start a
  // sync after the response is sent (never slows the page).
  const canDispatch = dispatchConfigured();
  if (canDispatch) after(() => requestSync(slug, { minGapMs: VISIT_STALE_MS, mode: "auto", by: "visit" }).catch((e) => console.error("visit sync", slug, e)));
  let member = false, commish = false;
  const user = await currentUser().catch(() => null);
  if (user && row.id !== "local") {
    // the league row is already loaded (row.id), and the two checks don't depend on each other
    const admin = supabaseAdmin();
    [member, commish] = await Promise.all([
      canDispatch ? admin.from("league_members").select("user_id").eq("league_id", row.id).eq("user_id", user.id).maybeSingle().then((r) => Boolean(r.data), () => false) : false,
      isCommissioner(row.id, user.id).catch(() => false),
    ]);
  }

  // NFL logos replace team abbreviations only for signed-in visitors (same rule as card art).
  const logosOn = await canSeeCardArt();

  return (
    <div className={logosOn ? "logos-on" : undefined} style={{ display: "contents" }}>
      <div className="league-head">
        <div className="wrap">
          <div className="league-title-row">
          <div className="league-title">
            <h1>{row.name}</h1>
            <div className="league-sub">
              {data ? `${data.season.year} ${data.season.title}` : "Waiting for the first sync"}
              <span className="dot-sep" aria-hidden />
              {syncStatusText(row.last_sync_status, row.last_synced_at)}
              {member && <><span className="dot-sep" aria-hidden /><SyncNowButton slug={slug} /></>}
            </div>
          </div>
          {data && <LeagueTools slug={slug} admin={commish} />}
          </div>
          {data && <LeagueNav slug={slug} />}
          <Toaster />
        </div>
      </div>
      {children}
    </div>
  );
}
