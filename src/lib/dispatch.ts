// Starts the sync worker (GitHub Actions "Sync leagues") right away instead of
// waiting for its schedule. Needs GITHUB_DISPATCH_TOKEN: a fine-grained token
// with Actions read/write on the cfm-manager repo. GITHUB_REPO defaults to
// NickyCamp/cfm-manager. Without the token, leagues sync on the schedule only.

export const dispatchConfigured = () => Boolean(process.env.GITHUB_DISPATCH_TOKEN);

/** slug "" = every league. Returns true when GitHub accepted the run. */
export async function triggerSync(slug: string, mode: "auto" | "full" = "full"): Promise<boolean> {
  const token = process.env.GITHUB_DISPATCH_TOKEN;
  const repo = process.env.GITHUB_REPO || "NickyCamp/cfm-manager";
  if (!token) return false;
  const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/sync-leagues.yml/dispatches`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "cfm-manager" },
    body: JSON.stringify({ ref: "main", inputs: { league: slug, mode } }),
  });
  if (res.status !== 204) console.error("sync dispatch failed", slug, res.status, await res.text().catch(() => ""));
  return res.status === 204;
}
