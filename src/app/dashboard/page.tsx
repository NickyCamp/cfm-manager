import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser, supabaseAdmin } from "@/lib/supabase/server";
import { CONSOLE_LABEL } from "@/lib/ea/constants";
import { syncStatusText } from "@/lib/format";

export const metadata: Metadata = { title: "My leagues" };
export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const user = await currentUser();
  if (!user) redirect("/login?next=/dashboard");

  const admin = supabaseAdmin();
  const { data: memberships } = await admin
    .from("league_members")
    .select("role, leagues (slug, name, console, last_sync_status, last_synced_at)")
    .eq("user_id", user.id)
    .order("joined_at", { ascending: true });

  type Row = { role: string; leagues: { slug: string; name: string; console: string; last_sync_status: string | null; last_synced_at: string | null } };
  const rows = ((memberships || []) as unknown as Row[]).filter((m) => m.leagues);

  return (
    <main className="page">
      <div className="wrap narrow">
        <h1>My leagues</h1>
        {rows.length === 0 ? (
          <div className="panel">
            <h2>Add your first league</h2>
            <p>Connect your EA account and pick a Connected Franchise league you&apos;re in. Anyone in the league can add it; if it&apos;s already here, you&apos;ll join it.</p>
            <Link className="btn btn-primary" href="/connect">Connect EA and add a league</Link>
          </div>
        ) : (
          <>
            <div className="panel">
              {rows.map(({ role, leagues: l }) => (
                <div className="league-row" key={l.slug}>
                  <div>
                    <div className="name">{l.name}</div>
                    <div className="meta">
                      {CONSOLE_LABEL[l.console] || l.console}, {role === "commissioner" ? "you added this league" : "member"}
                      {" "}<span className={`status ${l.last_sync_status || ""}`}>{syncStatusText(l.last_sync_status, l.last_synced_at)}</span>
                    </div>
                  </div>
                  <Link className="btn btn-quiet" href={`/l/${l.slug}`}>Open</Link>
                </div>
              ))}
            </div>
            <Link className="btn btn-primary" href="/connect">Add another league</Link>
          </>
        )}
      </div>
    </main>
  );
}
