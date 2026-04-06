"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type NeedsNamingImage = {
  id: string;
  title: string;
  filename: string;
  previewUrl: string;
  eventName: string;
  eventSlug: string;
  capturedAt: string;
  subjectMatchRetryCount: number;
  createdAt: string;
};

export default function NeedsNamesPage() {
  const [role, setRole] = useState<string | null>(null);
  const [images, setImages] = useState<NeedsNamingImage[]>([]);
  const [filterSlug, setFilterSlug] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const response = await fetch("/api/auth/me");
      const data = (await response.json()) as { user: { role: string } | null };
      setRole(data.user?.role ?? null);
    })();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    const q = filterSlug.trim() ? `?eventSlug=${encodeURIComponent(filterSlug.trim())}` : "";
    const response = await fetch(`/api/upload/needs-naming${q}`);
    const data = (await response.json()) as { ok: boolean; images?: NeedsNamingImage[]; message?: string };
    if (!data.ok) {
      setMessage(data.message || "Could not load list.");
      setImages([]);
    } else {
      setImages(data.images || []);
    }
    setLoading(false);
  }, [filterSlug]);

  useEffect(() => {
    if (role !== "PHOTOGRAPHER" && role !== "ADMIN") return;
    void load();
  }, [role, load]);

  const saveTitle = async (id: string) => {
    const title = (editing[id] ?? "").trim();
    if (!title) {
      setMessage("Enter a name before saving.");
      return;
    }
    setSavingId(id);
    setMessage(null);
    const response = await fetch(`/api/upload/needs-naming/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    const data = (await response.json()) as { ok: boolean; message?: string };
    setSavingId(null);
    if (!data.ok) {
      setMessage(data.message || "Save failed.");
      return;
    }
    setEditing((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setImages((prev) => prev.filter((img) => img.id !== id));
    setMessage("Saved and removed from this queue.");
  };

  if (role !== "PHOTOGRAPHER" && role !== "ADMIN") {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <p className="text-slate-600">Photographer or admin login required.</p>
        <Link href="/login" className="mt-2 inline-block text-blue-700 underline">
          Log in
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-5">
      <header>
        <p className="text-xs uppercase tracking-wide text-slate-500">Contributor Portal</p>
        <h1 className="text-2xl font-semibold text-slate-900">Name queue</h1>
        <p className="mt-2 text-sm text-slate-600">
          These catalog images were saved without a confident auto subject (no slate / no match).
          Enter the correct title to move them to manual resolved. When you later upload a slate for
          someone already in this event, we automatically re-try visual matching on these rows (up to
          several passes per image).
        </p>
        <p className="mt-2 text-sm">
          <Link href="/upload" className="font-semibold text-blue-700 underline">
            Back to upload
          </Link>
        </p>
      </header>

      <div className="flex flex-wrap items-end gap-3">
        <label className="block text-xs font-semibold text-slate-700">
          Filter by event slug (optional)
          <input
            value={filterSlug}
            onChange={(e) => setFilterSlug(e.target.value)}
            className="mt-1 block w-56 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
            placeholder="e.g. 11-genlux"
          />
        </label>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-lg bg-slate-800 px-3 py-2 text-xs font-semibold text-white"
        >
          Refresh
        </button>
      </div>

      {message ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {message}
        </p>
      ) : null}

      {loading ? <p className="text-sm text-slate-600">Loading…</p> : null}

      {!loading && images.length === 0 ? (
        <p className="text-sm text-slate-600">No images in this queue right now.</p>
      ) : null}

      <ul className="space-y-4">
        {images.map((img) => (
          <li
            key={img.id}
            className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3 sm:flex-row"
          >
            <div className="relative h-36 w-full shrink-0 overflow-hidden rounded-lg bg-slate-100 sm:h-32 sm:w-48">
              <Image
                src={img.previewUrl}
                alt=""
                fill
                className="object-cover"
                sizes="200px"
                unoptimized
              />
            </div>
            <div className="min-w-0 flex-1 space-y-2 text-sm">
              <p className="truncate font-medium text-slate-900">{img.eventName}</p>
              <p className="text-xs text-slate-500">
                {img.eventSlug} · {img.filename}
              </p>
              <p className="text-xs text-slate-500">
                Current title: <span className="font-semibold text-slate-800">{img.title}</span> ·
                auto re-tries: {img.subjectMatchRetryCount}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={editing[img.id] ?? img.title}
                  onChange={(e) => setEditing((p) => ({ ...p, [img.id]: e.target.value }))}
                  className="min-w-[12rem] flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                  placeholder="Person name (title)"
                />
                <button
                  type="button"
                  disabled={savingId === img.id}
                  onClick={() => void saveTitle(img.id)}
                  className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                >
                  {savingId === img.id ? "Saving…" : "Save name"}
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
