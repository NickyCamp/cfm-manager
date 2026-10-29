import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Finish signing in" };

export default async function ConfirmPage({ searchParams }: { searchParams: Promise<{ token_hash?: string; type?: string; next?: string }> }) {
  const { token_hash, type, next } = await searchParams;
  return (
    <main className="page">
      <div className="wrap narrow">
        <h1>Finish signing in</h1>
        {token_hash ? (
          <form method="post" action="/auth/confirm/verify" className="panel">
            <input type="hidden" name="token_hash" value={token_hash} />
            <input type="hidden" name="type" value={type || "email"} />
            <input type="hidden" name="next" value={next || "/dashboard"} />
            <p>Tap below to sign in to CFM Manager on this device.</p>
            <button className="btn btn-primary" type="submit">Sign in</button>
          </form>
        ) : (
          <div className="notice error">This sign-in link is incomplete. <Link href="/login">Send yourself a new one.</Link></div>
        )}
      </div>
    </main>
  );
}
