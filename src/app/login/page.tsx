import type { Metadata } from "next";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  return (
    <main className="page">
      <div className="wrap narrow">
        <h1>Sign in</h1>
        <p>Enter your email and we&apos;ll send you a sign-in link. New here? The same link creates your account.</p>
        {error === "link" && (
          <div className="notice error">That sign-in link didn&apos;t work. It may have expired. Send yourself a new one below.</div>
        )}
        <LoginForm next={next || "/dashboard"} />
      </div>
    </main>
  );
}
