import type { Metadata } from "next";
import Link from "next/link";
import { getLeagueData } from "@/lib/league/load";
import { isCommissioner, viewer } from "@/lib/marketStore";
import { buildAmnestyData } from "@/lib/league/amnestyData";
import { AmnestyAdmin } from "./AmnestyAdmin";

export const metadata: Metadata = { title: "Amnesty" };
type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ player?: string }> };

// 50% amnesty, commissioner side (Nick, 2026-11-20): search any player, see his full
// contract and exactly how to rebuild it in Madden so a cut charges half of today's
// penalty, all this season. Math in lib/league/amnesty.ts.
export default async function AmnestyPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { player } = await searchParams;
  const [v, d] = await Promise.all([viewer(slug), getLeagueData(slug)]);
  const commish = Boolean(v.leagueId && v.userId && (await isCommissioner(v.leagueId, v.userId).catch(() => false)));
  if (!commish || !d) {
    return (
      <main className="page league-page"><div className="wrap">
        <h2>Amnesty</h2>
        <p className="muted">{!v.userId ? "Sign in to see this page." : "Only the league's commissioner can use the admin panel."} Every team&apos;s Cap tab has an Amnesty view showing who it would help.</p>
      </div></main>
    );
  }
  const ad = buildAmnestyData(d);
  return (
    <main className="page league-page">
      <div className="wrap">
        <h2>Amnesty (50%)</h2>
        <p className="muted" style={{ maxWidth: "70ch" }}>
          Search any player to see his whole contract and how to rebuild it so cutting him charges exactly half of today&apos;s penalty, all in {ad.year}.{" "}
          <Link href={`/l/${slug}/admin`}>Back to Admin</Link>
        </p>
        <AmnestyAdmin slug={slug} year={ad.year} years={ad.years} players={ad.players} teams={ad.teams} initial={Number(player) || null} syncedAt={d.season ? `${d.season.year} ${d.season.title}` : ""} />
      </div>
    </main>
  );
}
