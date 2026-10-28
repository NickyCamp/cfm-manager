"use client";
import { useEffect } from "react";

// Registers the service worker that makes the app installable and lets league
// pages open without a connection (last-loaded data).
export function RegisterServiceWorker() {
  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);
  return null;
}
