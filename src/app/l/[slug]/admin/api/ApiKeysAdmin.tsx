"use client";
import { useState } from "react";

type Key = { id: string; name: string; hint: string; createdAt: string; revokedAt?: string };
type Tool = { name: string; title: string; description: string };

function Copy({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return <button type="button" className="btn btn-quiet small" onClick={() => { navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); }); }}>{done ? "Copied" : "Copy"}</button>;
}
const Code = ({ text }: { text: string }) => (
  <div style={{ display: "flex", gap: 8, alignItems: "flex-start", margin: "6px 0 12px" }}>
    <pre style={{ flex: 1, margin: 0, padding: "10px 12px", background: "rgba(0,0,0,.06)", borderRadius: 8, overflowX: "auto", fontSize: 13, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{text}</pre>
    <Copy text={text} />
  </div>
);

export function ApiKeysAdmin({ slug, origin, initial, tools }: { slug: string; origin: string; initial: Key[]; tools: Tool[] }) {
  const [keys, setKeys] = useState(initial);
  const [name, setName] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function post(body: object) {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(`/api/leagues/${slug}/api-keys`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) { setMsg(j.error || "Something went wrong."); return null; }
      setKeys(j.keys);
      return j;
    } finally { setBusy(false); }
  }

  const k = fresh ?? "<YOUR_KEY>";
  const mcpUrl = `${origin}/api/mcp/${k}`;
  const live = keys.filter((x) => !x.revokedAt);

  return (
    <>
      <section className="panel">
        <h3>Make a key</h3>
        <form onSubmit={async (e) => { e.preventDefault(); const j = await post({ name: name || "Agent key" }); if (j?.key) { setFresh(j.key); setName(""); } }} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input type="text" placeholder="Who it's for, e.g. Mike's podcast" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} style={{ flex: "1 1 260px" }} />
          <button className="btn btn-primary" disabled={busy}>Create key</button>
        </form>
        {msg && <p className="small" style={{ color: "#b3261e" }}>{msg}</p>}
        {fresh && (
          <div style={{ marginTop: 14 }}>
            <p className="small strong">Here&apos;s the key. Copy it now; it won&apos;t be shown again. Anyone with it can read this league&apos;s data, so send it privately.</p>
            <Code text={fresh} />
          </div>
        )}
      </section>

      <section className="panel">
        <h3>Keys</h3>
        {!keys.length ? <p className="muted small">No keys yet.</p> : (
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>Name</th><th>Ends in</th><th>Made</th><th>Status</th><th></th></tr></thead>
            <tbody>{[...keys].reverse().map((x) => (
              <tr key={x.id}>
                <td>{x.name}</td><td className="num">…{x.hint}</td><td className="small">{new Date(x.createdAt).toLocaleDateString()}</td>
                <td className="small">{x.revokedAt ? `revoked ${new Date(x.revokedAt).toLocaleDateString()}` : "live"}</td>
                <td>{!x.revokedAt && <button type="button" className="btn btn-quiet small" disabled={busy} onClick={() => { if (confirm(`Revoke "${x.name}"? Agents using it stop working within a minute.`)) post({ revoke: x.id }); }}>Revoke</button>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
        <p className="muted small">{live.length} live. Each key allows up to 120 calls a minute.</p>
      </section>

      <section className="panel">
        <h3>How to connect an agent</h3>
        <p className="small">The API speaks <strong>MCP</strong>, the standard way AI agents use outside tools, and plain <strong>REST/JSON</strong>. {fresh ? "The examples below have the new key filled in." : "Make a key and the examples below fill in with it."}</p>

        <h4>Claude (claude.ai, desktop) or ChatGPT</h4>
        <p className="small">Add a custom connector and paste this URL (the key is part of it, so keep it private). Claude: Settings → Connectors → Add custom connector. ChatGPT: Settings → Connectors (developer mode) → Create.</p>
        <Code text={mcpUrl} />

        <h4>Agent frameworks, voice agents (ElevenLabs, OpenAI Agents SDK, Claude Agent SDK, n8n…)</h4>
        <p className="small">Use a Streamable HTTP MCP server at this URL with the key as a bearer token, or just the URL above if the app only takes a URL.</p>
        <Code text={`URL: ${origin}/api/mcp\nHeader: Authorization: Bearer ${k}`} />

        <h4>Plain REST (scripts, anything else)</h4>
        <Code text={`curl -H "Authorization: Bearer ${k}" ${origin}/api/v1/l/${slug}/week_digest?week=latest`} />
        <p className="small">Every tool below is also <code>{`${origin}/api/v1/l/${slug}/<tool>`}</code> with its options as query parameters. <code>{`${origin}/api/v1/l/${slug}`}</code> lists them all.</p>

        <h4>A starting prompt for a podcast host agent</h4>
        <Code text={`You co-host a weekly podcast about our Madden franchise league. Before each episode, call week_digest for the latest week, then dig into the biggest storylines with box_score, player and team. Use the league members' names (the "user" of each team) when you talk about who won or lost. Only use numbers that come from the tools; never invent stats.`} />
      </section>

      <section className="panel">
        <h3>What agents can ask for</h3>
        <div className="tbl-wrap"><table className="tbl">
          <tbody>{tools.map((t) => <tr key={t.name}><td className="strong" style={{ whiteSpace: "nowrap" }}>{t.name}</td><td className="small">{t.description}</td></tr>)}</tbody>
        </table></div>
      </section>
    </>
  );
}
