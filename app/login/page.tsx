"use client";

// app/login/page.tsx
//
// Simple one-password login page. There's no username, no account
// system — just a single shared password (set via the SITE_PASSWORD
// environment variable) that unlocks the whole app.

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  // "from" is the page you were trying to reach before middleware.ts
  // redirected you here — so after logging in, we send you back to it
  // instead of always landing on the homepage.
  const from = searchParams.get("from") || "/";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Login failed.");
      }
      router.push(from);
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <form
        onSubmit={handleSubmit}
        className="bg-white rounded-md border border-slate-200 p-6 w-full max-w-sm space-y-4"
      >
        <h1 className="text-lg font-semibold">Enter password</h1>
        <p className="text-sm text-slate-500">This app is private. Enter the password to continue.</p>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
          className="w-full rounded-md border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-md bg-blue-600 text-white px-4 py-2 font-medium disabled:opacity-50"
        >
          {loading ? "Checking..." : "Enter"}
        </button>
      </form>
    </main>
  );
}

// useSearchParams() requires a <Suspense> boundary in Next.js's App
// Router — a small framework requirement, not something specific to
// this app. Wrapping it here satisfies that.
export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
