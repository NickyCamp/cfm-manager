import { notFound } from "next/navigation";
import { getLeagueData, getLeagueRow } from "@/lib/league/load";
import { LeagueNav } from "@/components/league/LeagueNav";
import { syncStatusText } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function LeagueLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const row = await getLeagueRow(slug);
  if (!row) notFound();
  const data = await getLeagueData(slug);

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
            </div>
          </div>
          {data && <LeagueNav slug={slug} />}
        </div>
      </div>
      {children}
    </>
  );
}
