// A small stateless MCP server (Streamable HTTP, JSON responses) over the agent tools.
// Stateless on purpose: Vercel functions don't keep sessions between calls, and every
// tool here is a read, so there's nothing to remember. Spec: modelcontextprotocol.io.

import { NextResponse } from "next/server";
import { TOOLS, ToolError, inputSchema, runTool } from "./tools";
import { checkKey, keyFromRequest, overLimit } from "./keys";

const VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

type Rpc = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: Record<string, unknown> };

const ok = (id: Rpc["id"], result: unknown) => ({ jsonrpc: "2.0", id: id ?? null, result });
const err = (id: Rpc["id"], code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, GET, OPTIONS, DELETE",
  "access-control-allow-headers": "authorization, content-type, mcp-protocol-version, mcp-session-id, x-api-key, last-event-id",
  "access-control-expose-headers": "mcp-session-id, mcp-protocol-version",
};

export function mcpOptions() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

/** GET opens a server-to-client stream in the spec; we don't push anything, so say so. */
export function mcpGet() {
  return new NextResponse("This MCP server only answers POST requests (no server-sent stream).", { status: 405, headers: { ...CORS, allow: "POST, OPTIONS" } });
}

export async function mcpPost(req: Request, pathKey?: string) {
  const key = await checkKey(keyFromRequest(req, pathKey));
  if (!key.ok) return NextResponse.json(err(null, -32001, key.error), { status: key.status, headers: CORS });
  if (overLimit(key.keyId)) return NextResponse.json(err(null, -32002, "Too many calls; slow down (limit 120 per minute)."), { status: 429, headers: { ...CORS, "retry-after": "30" } });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json(err(null, -32700, "Parse error"), { status: 400, headers: CORS }); }
  const batch = Array.isArray(body);
  const msgs = (batch ? body : [body]) as Rpc[];
  const out = (await Promise.all(msgs.map((m) => handle(m, key.slug, key.leagueName)))).filter((x): x is NonNullable<typeof x> => x !== null);
  if (!out.length) return new NextResponse(null, { status: 202, headers: CORS }); // only notifications
  return NextResponse.json(batch ? out : out[0], { headers: CORS });
}

async function handle(m: Rpc, slug: string, leagueName: string) {
  if (!m || m.jsonrpc !== "2.0" || typeof m.method !== "string") return err(m?.id, -32600, "Invalid request");
  const isNote = m.id === undefined;
  switch (m.method) {
    case "initialize": {
      const asked = String(m.params?.protocolVersion ?? "");
      return ok(m.id, {
        protocolVersion: VERSIONS.includes(asked) ? asked : VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "cfm-manager", title: `CFM Manager: ${leagueName}`, version: "1.0.0" },
        instructions: `Live data for the Madden franchise league "${leagueName}" (${slug}). Start with league_info, then week_digest for a week's storylines; use box_score, player, team, standings, leaders, transactions, cap_overview and dev_watch to dig in. All numbers come from the league's latest EA sync; don't invent stats that aren't in a tool result.`,
      });
    }
    case "ping": return ok(m.id, {});
    case "tools/list":
      return ok(m.id, { tools: TOOLS.map((t) => ({ name: t.name, title: t.title, description: t.description, inputSchema: inputSchema(t), annotations: { readOnlyHint: true, openWorldHint: false } })) });
    case "tools/call": {
      const name = String(m.params?.name ?? "");
      const args = (m.params?.arguments ?? {}) as Record<string, unknown>;
      try {
        const result = await runTool(slug, name, args);
        return ok(m.id, { content: [{ type: "text", text: JSON.stringify(result) }], isError: false });
      } catch (e) {
        if (e instanceof ToolError) return ok(m.id, { content: [{ type: "text", text: e.message }], isError: true });
        console.error("mcp tool failed", slug, name, e);
        return ok(m.id, { content: [{ type: "text", text: "That tool failed on the server; try again in a minute." }], isError: true });
      }
    }
    case "resources/list": return ok(m.id, { resources: [] });
    case "prompts/list": return ok(m.id, { prompts: [] });
    default:
      if (isNote || m.method.startsWith("notifications/")) return null;
      return err(m.id, -32601, `Method not found: ${m.method}`);
  }
}
