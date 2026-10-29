import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "@fontsource/barlow/400.css";
import "@fontsource/barlow/600.css";
import "@fontsource/barlow/700.css";
import "@fontsource/barlow-condensed/600.css";
import "@fontsource/barlow-condensed/700.css";
import "@fontsource/barlow-condensed/800.css";
import "./globals.css";
import { currentUser, supabaseConfigured } from "@/lib/supabase/server";
import { RegisterServiceWorker } from "@/components/RegisterServiceWorker";

export const metadata: Metadata = {
  title: { default: "CFM Manager", template: "%s · CFM Manager" },
  description: "A home for your Madden franchise league: standings, scores, cap space and contracts, synced from EA.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "CFM Manager", statusBarStyle: "black-translucent" },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: "#0f3d2e",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = supabaseConfigured() ? await currentUser() : null;
  return (
    <html lang="en">
      <body>
        <header className="site-head">
          <div className="wrap">
            <Link href={user ? "/dashboard" : "/"} className="brand">
              <img src="/icons/mark.svg" alt="" width={30} height={30} />
              CFM Manager
            </Link>
            <nav className="head-links" aria-label="Account">
              <Link href="/macro">Macro Builder</Link>
              {user ? (
                <>
                  <Link href="/dashboard">My leagues</Link>
                  <form action="/auth/signout" method="post">
                    <button type="submit">Sign out</button>
                  </form>
                </>
              ) : (
                <Link href="/login">Sign in</Link>
              )}
            </nav>
          </div>
        </header>
        {children}
        <RegisterServiceWorker />
      </body>
    </html>
  );
}
