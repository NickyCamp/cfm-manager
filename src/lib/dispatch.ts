// Starts the sync worker right away for one league (instead of waiting for the
// next 3-hourly run). Optional: needs GITHUB_DISPATCH_TOKEN (a fine-grained
// token with Actions read/write on the cfm-manager repo) and GITHUB_REPO
// ("owner/cfm-manager"). Without them the league syncs on the next scheduled run.

export async function triggerSync(slug: string, mode: "auto" | "full" = "full"): Promise<boolean> {
  const token = process.env.GITHUB_DISPATCH_TOKEN;
  const repo = process.env.GITHUB_REPO;
  if (!token || !repo) return false;
  const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/sync-leagues.yml/dispatches`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "cfm-manager" },
    body: JSON.stringify({ ref: "main", inputs: { league: slug, mode } }),
  });
  return res.status === 204;
}
