import type { Metadata } from "next";
import { Suspense } from "react";
import { FinishSignIn } from "./FinishSignIn";

export const metadata: Metadata = { title: "Signing in" };

export default function FinishPage() {
  return (
    <main className="page">
      <div className="wrap narrow">
        <h1>Signing in…</h1>
        <Suspense><FinishSignIn /></Suspense>
      </div>
    </main>
  );
}
