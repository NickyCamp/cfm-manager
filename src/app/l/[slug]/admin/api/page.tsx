import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { isCommissioner, viewer } from "@/lib/marketStore";
import { listKeys } from "@/lib/agent/keys";
import { TOOLS } from "@/lib/agent/tools";
import { ApiKeysAdmin } from "./ApiKeysAdmin";

export const metadata: Metadata = { title: "Agent API" };
type Props = { params: Promise<{ slug: string }> };

// Agent API keys + how to connect (Nick, 2026-11-24: an API a friend's AI agents can use for a league podcast).
export default async function AgentApiPage({ params }: Props) {
  const { slug } = await params;
  const v = await viewer(slug);
  const commish = Boolean(v.leagueId && v.userId && (await isCommissioner(v.leagueId, v.userId).catch(() => false)));
  if (!commish || !v.leagueId) {
    return (
      <main className="page league-page"><div className="wrap">
        <h2>Agent API</h2>
        <p className="muted">{!v.userId ? "Sign in to see this page." : "Only the league's commissioner can make API keys."}</p>
      </div></main>
    );
  }
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") || "https"}://${h.get("x-forwarded-host") || h.get("host")}`;
  const keys = await listKeys(v.leagueId);
  return (
    <main className="page league-page">
      <div className="wrap">
        <h2>Agent API</h2>
        <p className="muted" style={{ maxWidth: "75ch" }}>
          Give AI agents (a podcast host, a Discord assistant, a script) read-only access to this league&apos;s live data: results, box scores,
          players, teams, cap, transactions, playoff picture and a ready-made weekly digest. Each key reads only this league and can be revoked any time.{" "}
          <Link href={`/l/${slug}/admin`}>Back to Admin</Link>
        </p>
        <ApiKeysAdmin slug={slug} origin={origin} initial={keys} tools={TOOLS.map((t) => ({ name: t.name, title: t.title, description: t.description }))} />
      </div>
    </main>
  );
}
