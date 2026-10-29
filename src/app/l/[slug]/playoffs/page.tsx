import type { Metadata } from "next";
import Link from "next/link";
import { getLeagueData } from "@/lib/league/load";
import { confRecord, divRecord, playoffPicture, PLAYOFF_ROUNDS, recText, REG_WEEKS, tieNote, type Club, type Seed } from "@/lib/league/playoffs";
import { NoData, TeamBadge } from "@/components/league/bits";
import type { Team } from "@/lib/league/types";

export const metadata: Metadata = { title: "Playoff picture" };
type Props = { params: Promise<{ slug: string }> };

const MARK_TITLE: Record<string, string> = { "*": "Clinched the #1 seed", z: "Clinched the division", x: "Clinched a playoff spot", e: "Eliminated" };

export default async function Playoffs({ params }: Props) {
  const { slug } = await params;
  const d = await getLeagueData(slug);
  if (!d) return <NoData />;
  const pic = playoffPicture(d);
  const teamHref = (t: Team) => `/l/${slug}/teams/${t.abbr.toLowerCase()}`;
  const TeamCell = ({ c, mark }: { c: Club; mark?: string }) => (
    <Link className="team-link" href={teamHref(c.team)}>
      <TeamBadge team={c.team} size={22} /><span>{c.name}</span>
      {mark && <span className="po-mark" title={MARK_TITLE[mark]}>{mark}</span>}
    </Link>
  );
  const realPO = d.games.filter((g) => g.stage === 1 && g.week >= REG_WEEKS && g.home && g.away);
  const teams = new Map(d.teams.map((t) => [t.id, t]));
  const confs = Object.keys(pic.conf);

  return (
    <main className="page league-page">
      <div className="wrap">
        <h2>Playoff picture</h2>
        <p className="muted" style={{ maxWidth: "70ch" }}>
          {pic.regularSeasonDone ? "Final regular-season standings." : pic.throughWeek ? `If the season ended today, through Week ${pic.throughWeek}.` : "No regular-season games played yet."}{" "}
          Seeds and ties follow the NFL&apos;s tiebreaking procedures; the note under a team says which tiebreaker decided it.
        </p>

        <div className="po-confs">
          {confs.map((cf) => {
            const seeds = pic.conf[cf];
            const seventh = seeds[6]?.c;
            return (
              <section className="panel tbl-wrap" key={cf}>
                <table className="tbl">
                  <caption>{cf}</caption>
                  <thead><tr><th className="num">#</th><th>Team</th><th className="num">W-L</th><th className="num hide-sm">Div</th><th className="num hide-sm">Conf</th><th className="num">GB</th></tr></thead>
                  <tbody>
                    {seeds.map((s: Seed, i) => {
                      const c = s.c;
                      const why = i < 7 ? `${s.how}${i === 0 ? " · first-round bye" : ""}` : "";
                      const note = [why, tieNote(s)].filter(Boolean).join(" · ");
                      const gb = i < 7 || !seventh ? null : (seventh.w - c.w + (c.l - seventh.l)) / 2;
                      return [
                        i === 7 && <tr key="hunt" className="po-sep"><td colSpan={6}>In the hunt</td></tr>,
                        <tr key={c.id} className={i >= 7 ? (s.mark === "e" ? "po-out" : "po-hunt") : undefined}>
                          <td className="num strong">{i < 7 ? s.seed : ""}</td>
                          <td><TeamCell c={c} mark={s.mark} />{note && <div className="po-note">{note}</div>}</td>
                          <td className="num strong">{recText(c.w, c.l, c.t)}</td>
                          <td className="num muted hide-sm">{divRecord(c)}</td>
                          <td className="num muted hide-sm">{confRecord(c)}</td>
                          <td className="num muted">{gb == null ? "" : gb === 0 ? "—" : gb}</td>
                        </tr>,
                      ];
                    })}
                  </tbody>
                </table>
              </section>
            );
          })}
        </div>
        <p className="hint">* clinched the #1 seed · z clinched the division · x clinched a playoff spot · e eliminated. The marks are conservative: they only appear once no remaining results could change them.</p>

        <h3 className="po-h">Bracket</h3>
        <div className="po-bracket">
          {realPO.length > 0
            ? PLAYOFF_ROUNDS.map(([wk, label]) => {
              const gs = realPO.filter((g) => g.week === wk);
              if (!gs.length) return null;
              return (
                <div className="panel po-round" key={wk}>
                  <h4>{label}</h4>
                  {gs.map((g) => <Matchup key={g.id} slug={slug} away={teams.get(g.away)} home={teams.get(g.home)} scores={g.final ? [g.as, g.hs] : null} gameId={g.id} />)}
                </div>
              );
            })
            : confs.map((cf) => {
              const s = pic.conf[cf];
              if (s.length < 7) return null;
              return (
                <div className="panel po-round" key={cf}>
                  <h4>{cf} Wild Card round <span className="muted small">projected</span></h4>
                  <p className="small muted">Bye: #1 {s[0].c.name}</p>
                  {[[1, 6], [2, 5], [3, 4]].map(([h, a]) => <Matchup key={h} slug={slug} away={s[a].c.team} home={s[h].c.team} seeds={[a + 1, h + 1]} />)}
                </div>
              );
            })}
        </div>

        <h3 className="po-h">Division races</h3>
        <div className="po-divs">
          {[...pic.divRows.entries()].map(([div, rows]) => {
            const lead = rows[0].c;
            return (
              <div className="panel" key={div}>
                <h4>{div}</h4>
                <ul className="po-div">
                  {rows.map((r, i) => {
                    const c = r.c, gb = (lead.w - c.w + (c.l - lead.l)) / 2, note = tieNote(r);
                    return (
                      <li key={c.id}>
                        <div><TeamCell c={c} />{note && <div className="po-note">{note}</div>}</div>
                        <span className="num">{recText(c.w, c.l, c.t)}{i > 0 && <span className="muted small"> {gb ? `${gb} GB` : "tied"}</span>}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
        <p className="hint">
          Tiebreakers follow <a href="https://www.nfl.com/standings/tie-breaking-procedures" target="_blank" rel="noopener noreferrer">the NFL&apos;s procedures</a> in order: head-to-head, division, common games, conference, strength of victory, strength of schedule, points rankings, net points, net touchdowns.
          Two stand-ins: net touchdowns come from the box scores (return touchdowns aren&apos;t in EA&apos;s data), and a coin toss is replaced by alphabetical order.
          Madden&apos;s own seeds can differ when its tiebreakers do.
        </p>
      </div>
    </main>
  );
}

function Matchup({ slug, away, home, seeds, scores, gameId }: { slug: string; away?: Team; home?: Team; seeds?: [number, number]; scores?: [number, number] | null; gameId?: number }) {
  const row = (t: Team | undefined, seed: number | undefined, sc: number | undefined) => (
    <div className="po-team">
      <span className="team-link">{seed != null && <span className="muted small po-seed">#{seed}</span>}<TeamBadge team={t} size={20} />{t ? `${t.city} ${t.name}` : "TBD"}</span>
      <span className="strong">{sc ?? ""}</span>
    </div>
  );
  const body = <>{row(away, seeds?.[0], scores?.[0])}{row(home, seeds?.[1], scores?.[1])}</>;
  return scores && gameId ? <Link className="po-match" href={`/l/${slug}/games/${gameId}`}>{body}</Link> : <div className="po-match">{body}</div>;
}
