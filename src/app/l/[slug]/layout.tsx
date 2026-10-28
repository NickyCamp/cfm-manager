import { notFound } from "next/navigation";
import { after } from "next/server";
import { currentUser, supabaseAdmin } from "@/lib/supabase/server";
import { dispatchConfigured } from "@/lib/dispatch";
import { requestSync, VISIT_STALE_MS } from "@/lib/sync";
import { SyncNowButton } from "@/components/league/SyncNowButton";
import { getLeagueData, getLeagueRow } from "@/lib/league/load";
import { LeagueNav } from "@/components/league/LeagueNav";
import { syncStatusText } from "@/lib/format";

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
  let member = false;
  if (canDispatch) {
    const user = await currentUser().catch(() => null);
    if (user) {
      const admin = supabaseAdmin();
      const { data: lg } = await admin.from("leagues").select("id, owner_id").eq("slug", slug).maybeSingle();
      if (lg) member = lg.owner_id === user.id || Boolean((await admin.from("league_members").select("user_id").eq("league_id", lg.id).eq("user_id", user.id).maybeSingle()).data);
    }
  }

  return (
    <>
      <div className="league-head">
        <div className="wrap">
          <div className="league-title">
            <h1>{row.name}</h1>
            <div className="league-sub">
              {data ? `${data.season.year} ${data.season.title}` : "Waiting for the first sync"}
              <span className="dot-sep" aria-hidden />
              {syncStatusText(row.last_sync_status, row.last_synced_at)}
              {member && <><span className="dot-sep" aria-hidden /><SyncNowButton slug={slug} /></>}
            </div>
          </div>
          {data && <LeagueNav slug={slug} />}
        </div>
      </div>
      {children}
    </>
  );
}
