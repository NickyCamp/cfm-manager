import type { Metadata } from "next";
import { ResetPasswordForm } from "./ResetPasswordForm";

export const metadata: Metadata = { title: "Choose a new password" };

// Reached from the password-reset email: the link signs the person in
// (/auth/callback → /auth/finish) and then sends them here.
export default function ResetPasswordPage() {
  return (
    <main className="page">
      <div className="wrap narrow">
        <h1>Choose a new password</h1>
        <ResetPasswordForm />
      </div>
    </main>
  );
}
