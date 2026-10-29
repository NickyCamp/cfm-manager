/** Only same-site paths are allowed as the page to land on after signing in. */
export const safeNext = (next: string | null | undefined) => (next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard");
