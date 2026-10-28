import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/supabase/server";
import { EA_SIGN_IN_URL } from "@/lib/ea/constants";
import { ConnectWizard } from "./ConnectWizard";

export const metadata: Metadata = { title: "Add a league" };
export const dynamic = "force-dynamic";

export default async function ConnectPage() {
  if (!(await currentUser())) redirect("/login?next=/connect");
  return (
    <main className="page">
      <div className="wrap narrow">
        <h1>Add a league</h1>
        <p>Use the EA account linked to the console you play Madden on.</p>
        <ConnectWizard eaSignInUrl={EA_SIGN_IN_URL} />
      </div>
    </main>
  );
}
