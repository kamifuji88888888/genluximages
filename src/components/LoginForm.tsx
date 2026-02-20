"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export function LoginForm({ nextPath }: { nextPath: string }) {
  const router = useRouter();
  const [status, setStatus] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setStatus("");

    const formData = new FormData(event.currentTarget);
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(formData.entries())),
    });

    const data = (await response.json()) as { ok: boolean; message: string };
    setStatus(data.message);
    setIsSubmitting(false);
    if (data.ok) router.push(nextPath);
  };

  return (
    <>
      <form className="grid gap-3" onSubmit={handleSubmit}>
        <input
          required
          name="name"
          placeholder="Full name"
          className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
        />
        <input
          required
          type="email"
          name="email"
          placeholder="Email"
          className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
        />
        <select
          required
          name="role"
          defaultValue="BUYER"
          className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="BUYER">Agency / Publication Buyer</option>
          <option value="PHOTOGRAPHER">Photographer Contributor</option>
          <option value="ADMIN">Admin Editor</option>
        </select>
        <button
          disabled={isSubmitting}
          type="submit"
          className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-60"
        >
          {isSubmitting ? "Signing in..." : "Sign in"}
        </button>
      </form>

      {status ? <p className="text-sm text-slate-600">{status}</p> : null}
    </>
  );
}
