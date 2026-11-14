import type { Metadata } from "next";
import Link from "next/link";
import { currentUser } from "@/lib/supabase/server";
import { discordOfUser, readLinkToken } from "@/lib/tickets";

export const metadata: Metadata = { title: "Link Discord" };
export const dynamic = "force-dynamic";
type Props = { searchParams: Promise<Record<string, string | undefined>> };

// Confirms a Discord account link handed out by the bot's /connect (Nick, 2026-11-13).
// Needed for betting league Tickets: the site pays and charges your Discord account in UnbelievaBoat.
export default async function LinkDiscord({ searchParams }: Props) {
  const sp = await searchParams;
  const t = sp.t || "";
  const tok = t ? readLinkToken(t) : null;
  const user = await currentUser().catch(() => null);
  const current = user ? await discordOfUser(user.id).catch(() => null) : null;
  const here = `/link-discord?t=${encodeURIComponent(t)}`;

  return (
    <main className="page">
      <div className="wrap" style={{ maxWidth: 560 }}>
        <h2>Link Discord</h2>
        {sp.done ? (
          <div className="panel"><p>Done: your Discord account <strong>{current?.name || "is"}</strong> linked. League Tickets bets now use your UnbelievaBoat balance.</p><p><Link href="/dashboard">Back to your leagues</Link></p></div>
        ) : !tok ? (
          <div className="panel"><p>This link is invalid or has expired (links last 15 minutes). Run <code>/connect</code> in your league&apos;s Discord again.</p></div>
        ) : !user ? (
          <div className="panel"><p>Sign in to CFM Manager first, then this page will link Discord account <strong>{tok.name}</strong> to you.</p><p><Link className="btn btn-primary" href={`/login?next=${encodeURIComponent(here)}`}>Sign in</Link></p></div>
        ) : (
          <div className="panel">
            <p>Link Discord account <strong>{tok.name}</strong> to your CFM Manager account <strong>{user.email}</strong>?</p>
            <p className="muted small">Market bets in league Tickets will be taken from, and paid into, this Discord account&apos;s UnbelievaBoat balance. Only confirm if this Discord account is yours.</p>
            {current && current.id !== tok.discordId && <p className="small">This replaces the Discord account linked now ({current.name || current.id}).</p>}
            <form method="post" action="/api/link-discord">
              <input type="hidden" name="t" value={t} />
              <button className="btn btn-primary" type="submit">Yes, link it</button>
            </form>
          </div>
        )}
      </div>
    </main>
  );
}
