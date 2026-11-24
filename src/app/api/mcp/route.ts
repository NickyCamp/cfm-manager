// MCP endpoint for AI agents (Nick, 2026-11-24). Key in an Authorization: Bearer header (or ?key=).
// Agent apps that only take a URL use /api/mcp/<key> instead. See lib/agent/.
import { mcpGet, mcpOptions, mcpPost } from "@/lib/agent/mcp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const POST = (req: Request) => mcpPost(req);
export const GET = () => mcpGet();
export const OPTIONS = () => mcpOptions();
