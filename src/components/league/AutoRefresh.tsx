"use client";
// Re-renders the page's server data every few seconds while the tab is visible (embeds stay put).
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function AutoRefresh({ seconds }: { seconds: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => { if (document.visibilityState === "visible") router.refresh(); }, seconds * 1000);
    return () => clearInterval(id);
  }, [router, seconds]);
  return null;
}
