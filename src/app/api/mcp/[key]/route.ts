// MCP endpoint with the API key in the URL, for agent apps (Claude, ChatGPT connectors) that only take a URL.
// Treat the URL like a password. See lib/agent/.
import { mcpGet, mcpOptions, mcpPost } from "@/lib/agent/mcp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
type Ctx = { params: Promise<{ key: string }> };

export async function POST(req: Request, ctx: Ctx) { return mcpPost(req, (await ctx.params).key); }
export const GET = () => mcpGet();
export const OPTIONS = () => mcpOptions();
