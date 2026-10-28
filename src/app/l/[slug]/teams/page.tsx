import type { Metadata } from "next";
import Link from "next/link";
import { getLeagueData } from "@/lib/league/load";
import { record } from "@/lib/league/derive";
import { money } from "@/lib/league/format";
import { NoData, TeamBadge } from "@/components/league/bits";

export const metadata: Metadata = { title: "Teams" };
type Props = { params: Promise<{ slug: string }> };

export default async function Teams({ params }: Props) {
  const { slug } = await params;
  const d = await getLeagueData(slug);
  if (!d) return <NoData />;
  const divs = new Map<string, typeof d.teams>();
  for (const t of [...d.teams].sort((a, b) => a.name.localeCompare(b.name))) {
    if (!divs.has(t.division)) divs.set(t.division, []);
    divs.get(t.division)!.push(t);
  }
  return (
    <main className="page league-page">
      <div className="wrap">
        <h2 className="sr-only">Teams</h2>
        <div className="team-dir">
          {[...divs.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([div, ts]) => (
            <section key={div}>
              <h3>{div}</h3>
              <ul>
                {ts.map((t) => (
                  <li key={t.id}>
                    <Link href={`/l/${slug}/teams/${t.abbr.toLowerCase()}`} className="team-tile" style={{ borderLeftColor: t.primary }}>
                      <TeamBadge team={t} size={34} />
                      <span className="tt-main">
                        <span className="tt-name">{t.city} {t.name}</span>
                        <span className="muted small">{t.user || "CPU"}</span>
                      </span>
                      <span className="tt-side">
                        <span className="strong">{record(t)}</span>
                        <span className={`small ${t.cap.available < 0 ? "neg" : "muted"}`}>{money(t.cap.available)} room</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}
