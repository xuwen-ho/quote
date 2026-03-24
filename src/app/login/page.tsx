"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [isSignup, setIsSignup] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      if (isSignup) {
        const res = await fetch("/api/auth/signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password, name: name || undefined }),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Signup failed");
        }
      }

      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });

      if (result?.error) {
        throw new Error("Invalid email or password");
      }

      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--cream)" }}>
      <div className="fixed inset-0 dot-grid pointer-events-none" style={{ opacity: 0.4 }} />

      <div
        className="relative z-10 w-full max-w-sm rounded-2xl p-8"
        style={{
          background: "rgba(255,255,255,0.85)",
          boxShadow: "var(--shadow-md)",
          backdropFilter: "blur(14px)",
        }}
      >
        <h1
          className="text-xl font-semibold mb-1"
          style={{ color: "var(--charcoal)" }}
        >
          {isSignup ? "Create Account" : "Sign In"}
        </h1>
        <p className="text-sm mb-6" style={{ color: "var(--stone)" }}>
          {isSignup
            ? "Save your quotes and custom rates"
            : "Access your saved quotes and rates"}
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          {isSignup && (
            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: "var(--stone)" }}>
                Name (optional)
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl text-sm border outline-none transition-colors focus:border-[var(--sage)]"
                style={{ borderColor: "var(--cream-border)", color: "var(--charcoal)", background: "rgba(245,240,232,0.5)" }}
                placeholder="Your name"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: "var(--stone)" }}>
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full px-3.5 py-2.5 rounded-xl text-sm border outline-none transition-colors focus:border-[var(--sage)]"
              style={{ borderColor: "var(--cream-border)", color: "var(--charcoal)", background: "rgba(245,240,232,0.5)" }}
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: "var(--stone)" }}>
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              className="w-full px-3.5 py-2.5 rounded-xl text-sm border outline-none transition-colors focus:border-[var(--sage)]"
              style={{ borderColor: "var(--cream-border)", color: "var(--charcoal)", background: "rgba(245,240,232,0.5)" }}
              placeholder={isSignup ? "Min 6 characters" : "Your password"}
            />
          </div>

          {error && (
            <p className="text-xs font-medium px-3 py-2 rounded-lg" style={{ background: "rgba(200,100,100,0.1)", color: "#A04040" }}>
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-xl text-sm font-semibold transition-all hover:opacity-90 active:scale-[0.98]"
            style={{ background: "var(--charcoal)", color: "white", opacity: loading ? 0.6 : 1 }}
          >
            {loading ? "Please wait..." : isSignup ? "Create Account" : "Sign In"}
          </button>
        </form>

        <div className="mt-5 text-center">
          <button
            onClick={() => { setIsSignup(!isSignup); setError(""); }}
            className="text-sm font-medium hover:underline"
            style={{ color: "var(--sage-dark)" }}
          >
            {isSignup ? "Already have an account? Sign in" : "Need an account? Sign up"}
          </button>
        </div>

        <div className="mt-4 text-center">
          <button
            onClick={() => router.push("/")}
            className="text-xs hover:underline"
            style={{ color: "var(--stone)" }}
          >
            Continue without signing in
          </button>
        </div>
      </div>
    </div>
  );
}
