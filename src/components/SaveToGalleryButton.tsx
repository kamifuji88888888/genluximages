"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

const LOCAL_SAVED_IMAGE_IDS_KEY = "genlux_local_saved_image_ids";
const LOCAL_SAVED_UPDATED_EVENT = "genlux-local-saved-updated";

type GallerySummary = {
  id: string;
  name: string;
  mode: "private" | "team" | "shared_link";
  itemCount: number;
};

type GalleriesResponse = {
  ok: boolean;
  galleries?: GallerySummary[];
  message?: string;
};

type Props = {
  imageId: string;
  isLoggedIn: boolean;
};

function readLocalSavedImageIds() {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(LOCAL_SAVED_IMAGE_IDS_KEY) || "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is string => typeof value === "string");
  } catch {
    return [];
  }
}

function writeLocalSavedImageIds(imageIds: string[]) {
  if (typeof window === "undefined") return;
  const uniqueImageIds = Array.from(new Set(imageIds));
  window.localStorage.setItem(LOCAL_SAVED_IMAGE_IDS_KEY, JSON.stringify(uniqueImageIds));
  window.dispatchEvent(
    new CustomEvent(LOCAL_SAVED_UPDATED_EVENT, {
      detail: { count: uniqueImageIds.length },
    }),
  );
}

export function SaveToGalleryButton({ imageId, isLoggedIn }: Props) {
  const [galleries, setGalleries] = useState<GallerySummary[]>([]);
  const [selectedGalleryId, setSelectedGalleryId] = useState("");
  const [newGalleryName, setNewGalleryName] = useState("");
  const [status, setStatus] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [savedLocally, setSavedLocally] = useState(false);

  const selectedGallery = useMemo(
    () => galleries.find((gallery) => gallery.id === selectedGalleryId) ?? null,
    [galleries, selectedGalleryId],
  );

  const refresh = useCallback(async () => {
    if (!isLoggedIn) return;
    const response = await fetch("/api/galleries");
    const data = (await response.json()) as GalleriesResponse;
    if (!data.ok || !data.galleries) return;
    setGalleries(
      data.galleries.map((gallery) => ({
        id: gallery.id,
        name: gallery.name,
        mode: gallery.mode,
        itemCount: gallery.itemCount,
      })),
    );
    setSelectedGalleryId((current) => {
      if (current && data.galleries?.some((entry) => entry.id === current)) return current;
      return data.galleries?.[0]?.id ?? "";
    });
  }, [isLoggedIn]);

  useEffect(() => {
    const localIds = readLocalSavedImageIds();
    setSavedLocally(localIds.includes(imageId));
    if (!isLoggedIn) return;
    void refresh();
  }, [imageId, isLoggedIn, refresh]);

  useEffect(() => {
    if (!isLoggedIn) return;
    const localIds = readLocalSavedImageIds();
    if (!localIds.length) return;
    void (async () => {
      const response = await fetch("/api/galleries/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageIds: localIds, galleryName: "My Saved Picks" }),
      });
      const data = (await response.json()) as {
        ok: boolean;
        addedCount?: number;
        skippedCount?: number;
      };
      if (!data.ok) return;
      window.localStorage.removeItem(LOCAL_SAVED_IMAGE_IDS_KEY);
      window.dispatchEvent(new CustomEvent(LOCAL_SAVED_UPDATED_EVENT, { detail: { count: 0 } }));
      setSavedLocally(false);
      setStatus(
        `Synced local picks to "My Saved Picks" (${data.addedCount ?? 0} added, ${data.skippedCount ?? 0} skipped).`,
      );
      await refresh();
    })();
  }, [isLoggedIn, refresh]);

  const createGallery = async () => {
    const trimmed = newGalleryName.trim();
    if (!trimmed) return;
    setBusy(true);
    setStatus("");
    try {
      const response = await fetch("/api/galleries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed, mode: "private" }),
      });
      const data = (await response.json()) as { ok: boolean; message?: string };
      if (!data.ok) {
        setStatus(data.message ?? "Could not create gallery.");
      } else {
        setStatus("Gallery created.");
        setNewGalleryName("");
        await refresh();
      }
    } finally {
      setBusy(false);
    }
  };

  const saveImage = async () => {
    if (!isLoggedIn) {
      const localIds = readLocalSavedImageIds();
      if (!localIds.includes(imageId)) {
        localIds.push(imageId);
        writeLocalSavedImageIds(localIds);
      }
      setSavedLocally(true);
      setStatus('Saved locally in this browser. Log in to sync to "My Saved Picks".');
      return;
    }
    if (!selectedGalleryId) {
      setStatus("Select a gallery first.");
      return;
    }
    setBusy(true);
    setStatus("");
    try {
      const response = await fetch(`/api/galleries/${selectedGalleryId}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageId }),
      });
      const data = (await response.json()) as { ok: boolean; message?: string };
      setStatus(data.ok ? "Image saved to gallery." : (data.message ?? "Could not save image."));
      if (data.ok) await refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Saved galleries</p>
      {isLoggedIn ? (
        <>
          <div className="flex gap-2">
            <select
              value={selectedGalleryId}
              onChange={(event) => setSelectedGalleryId(event.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              <option value="">Select gallery...</option>
              {galleries.map((gallery) => (
                <option key={gallery.id} value={gallery.id}>
                  {gallery.name} ({gallery.mode}, {gallery.itemCount})
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={saveImage}
              disabled={busy}
              className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              Save
            </button>
          </div>
          <div className="flex gap-2">
            <input
              value={newGalleryName}
              onChange={(event) => setNewGalleryName(event.target.value)}
              placeholder="New gallery name"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            />
            <button
              type="button"
              onClick={createGallery}
              disabled={busy}
              className="rounded-lg bg-white px-3 py-2 text-sm font-semibold text-slate-900 ring-1 ring-slate-300 disabled:opacity-50"
            >
              Create
            </button>
          </div>
          {selectedGallery ? (
            <p className="text-xs text-slate-500">
              Saving into <span className="font-semibold text-slate-700">{selectedGallery.name}</span>
            </p>
          ) : null}
        </>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-slate-500">
            Not logged in. Save picks locally now, then sync after login.
          </p>
          <button
            type="button"
            onClick={saveImage}
            disabled={busy}
            className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {savedLocally ? "Saved Locally" : "Save Locally"}
          </button>
        </div>
      )}
      {status ? <p className="text-xs text-slate-600">{status}</p> : null}
    </div>
  );
}
