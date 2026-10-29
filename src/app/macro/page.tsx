import type { Metadata } from "next";
import { SET_COUNT } from "@/lib/macro/formations";
import { MacroBuilder } from "./MacroBuilder";

export const metadata: Metadata = {
  title: "Macro Builder",
  description: "Draw a Madden 27 macro on any formation — zones, blitzes, man matchups, hot routes — and share it with a link.",
};

export default function MacroPage() {
  return (
    <main className="page page-tight mb-page">
      <div className="wrap">
        <header className="mb-head">
          <h1>Macro Builder</h1>
          <p className="muted">
            Every Madden 27 formation ({SET_COUNT.D} defensive sets, {SET_COUNT.O} offensive). Pick one, set your assignments,
            and share the picture.
          </p>
        </header>
        <MacroBuilder />
      </div>
    </main>
  );
}
