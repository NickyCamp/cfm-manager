import type { Metadata } from "next";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  return (
    <main className="page">
      <div className="wrap narrow">
        <h1>Sign in</h1>
        <p>New here? Choose Create account. You&apos;ll connect your EA account and pick your league next.</p>
        {error === "link" && (
          <div className="notice error">That sign-in link didn&apos;t work. It may have expired or been opened already. Send yourself a new one below and type the code from the email instead.</div>
        )}
        <LoginForm next={next || "/dashboard"} />
      </div>
    </main>
  );
}
