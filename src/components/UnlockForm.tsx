"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export function UnlockForm({
  eventSlug,
  nextPath,
}: {
  eventSlug: string;
  nextPath: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus("");
    setIsSubmitting(true);

    const formData = new FormData(event.currentTarget);
    const accessCode = formData.get("accessCode");

    const response = await fetch("/api/event-access/enter", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventSlug, accessCode }),
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
          name="accessCode"
          placeholder="Enter event access code"
          className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={isSubmitting || !eventSlug}
          className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-60"
        >
          {isSubmitting ? "Unlocking..." : "Unlock gallery"}
        </button>
      </form>

      {status ? <p className="text-sm text-slate-600">{status}</p> : null}
    </>
  );
}
