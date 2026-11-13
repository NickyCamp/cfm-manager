import type { Metadata } from "next";
import Link from "next/link";
import { currentUser } from "@/lib/supabase/server";
import { ResetPasswordForm } from "./ResetPasswordForm";

export const metadata: Metadata = { title: "Choose a new password" };
export const dynamic = "force-dynamic";

// Reached from the password-reset email: the link signs the person in
// (/auth/callback → /auth/finish) and then sends them here.
export default async function ResetPasswordPage() {
  const user = await currentUser();
  return (
    <main className="page">
      <div className="wrap narrow">
        <h1>Choose a new password</h1>
        {user ? (
          <ResetPasswordForm email={user.email ?? ""} />
        ) : (
          <div className="notice error">
            This reset link has expired or was already used. <Link href="/login">Request a new one</Link> from the Forgot password tab.
          </div>
        )}
      </div>
    </main>
  );
}
