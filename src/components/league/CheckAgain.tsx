"use client";
// Live tab: re-checks who's streaming on demand (the page doesn't poll Twitch/Kick on its own).
// Adds ?check=<time> so the server skips its 1-minute cache for this load.
import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export function CheckAgain() {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const last = params.get("check");
  const at = last ? new Date(Number(last)).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
  return (
    <button type="button" className="btn-link" disabled={pending}
      onClick={() => start(() => router.replace(`${path}?check=${Date.now()}`, { scroll: false }))}>
      {pending ? "Checking…" : at ? `Check again (last ${at})` : "Check again"}
    </button>
  );
}
