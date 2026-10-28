import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { supabaseUser } from "@/lib/supabase/server";
import { CONSOLE_LABEL } from "@/lib/ea/constants";
import { syncStatusText } from "@/lib/format";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ new?: string; joined?: string }> };

async function getLeague(slug: string) {
  const sb = await supabaseUser();
  const { data } = await sb
    .from("leagues")
    .select("id, slug, name, console, last_sync_status, last_synced_at")
    .eq("slug", slug)
    .maybeSingle();
  return data;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const l = await getLeague(slug);
  return { title: l?.name || "League" };
}

export default async function LeaguePage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { new: isNew, joined } = await searchParams;
  const league = await getLeague(slug);
  if (!league) notFound();

  const sb = await supabaseUser();
  const { data: runs } = await sb
    .from("sync_runs")
    .select("started_at, result, report")
    .eq("league_id", league.id)
    .order("started_at", { ascending: false })
    .limit(1);
  const lastRun = runs?.[0];
  const waiting = !league.last_sync_status || league.last_sync_status === "pending";

  return (
    <main className="page">
      <div className="wrap narrow">
        {isNew && <div className="notice ok">League added. The first sync pulls every roster and week from EA, which takes a few minutes.</div>}
        {joined && <div className="notice ok">You joined this league.</div>}
        <h1>{league.name}</h1>
        <p>
          {CONSOLE_LABEL[league.console] || league.console}{" "}
          <span className={`status ${league.last_sync_status || ""}`}>{syncStatusText(league.last_sync_status, league.last_synced_at)}</span>
        </p>

        <div className="panel">
          <h2>{waiting ? "Waiting for the first sync" : "League pages are on the way"}</h2>
          <p>
            {waiting
              ? "CFM Manager checks EA every 3 hours. Once the first pull finishes, this page fills in with standings, scores, cap space, contracts and transactions."
              : "Your league's data is synced. Standings, scores, cap and contract pages are being added next."}
          </p>
          {lastRun?.result === "failed" && lastRun.report && (
            <div className="notice error">
              The last sync didn&apos;t finish. {firstProblem(lastRun.report)}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

function firstProblem(report: string): string {
  const line = report.split("\n").find((l) => l.includes("**"));
  return line ? line.replace(/^[-\s]*/, "").replaceAll("**", "") : "";
}
