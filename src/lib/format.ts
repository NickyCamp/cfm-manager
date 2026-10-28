export function syncStatusText(status: string | null, at: string | null): string {
  if (!status || status === "pending") return "Waiting for first sync";
  if (status === "failed") return "Last sync failed";
  if (!at) return "Synced";
  return `Synced ${timeAgo(at)}`;
}

export function timeAgo(iso: string): string {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  const days = Math.round(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
