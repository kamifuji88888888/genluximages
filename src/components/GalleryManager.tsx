"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type ShareLink = {
  token: string;
  expiresAt: string | null;
};

type Member = {
  userId: string;
  role: "viewer" | "editor";
  user: { name: string; email: string };
};

type Props = {
  galleryId: string;
  canManage: boolean;
  members: Member[];
  shareLinks: ShareLink[];
  itemImageIds: string[];
};

export function GalleryManager({ galleryId, canManage, members, shareLinks, itemImageIds }: Props) {
  const router = useRouter();
  const [status, setStatus] = useState("");
  const [memberEmail, setMemberEmail] = useState("");
  const [memberRole, setMemberRole] = useState<"viewer" | "editor">("viewer");
  const [busy, setBusy] = useState(false);

  if (!canManage) return null;

  const createShare = async () => {
    setBusy(true);
    setStatus("");
    try {
      const response = await fetch(`/api/galleries/${galleryId}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expiresInDays: 30 }),
      });
      const data = (await response.json()) as { ok: boolean; message?: string };
      setStatus(data.ok ? "Share link created." : (data.message ?? "Could not create share link."));
      if (data.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const revokeShare = async (token: string) => {
    setBusy(true);
    setStatus("");
    try {
      const response = await fetch(`/api/galleries/${galleryId}/share?token=${encodeURIComponent(token)}`, {
        method: "DELETE",
      });
      const data = (await response.json()) as { ok: boolean; message?: string };
      setStatus(data.ok ? "Share link revoked." : (data.message ?? "Could not revoke link."));
      if (data.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const addMember = async () => {
    if (!memberEmail.trim()) return;
    setBusy(true);
    setStatus("");
    try {
      const response = await fetch(`/api/galleries/${galleryId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: memberEmail.trim(), role: memberRole }),
      });
      const data = (await response.json()) as { ok: boolean; message?: string };
      setStatus(data.ok ? "Member added." : (data.message ?? "Could not add member."));
      if (data.ok) {
        setMemberEmail("");
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  };

  const removeImage = async (imageId: string) => {
    setBusy(true);
    setStatus("");
    try {
      const response = await fetch(
        `/api/galleries/${galleryId}/items?imageId=${encodeURIComponent(imageId)}`,
        { method: "DELETE" },
      );
      const data = (await response.json()) as { ok: boolean; message?: string };
      setStatus(data.ok ? "Image removed from gallery." : (data.message ?? "Could not remove image."));
      if (data.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
      <h2 className="text-lg font-semibold text-slate-900">Manage gallery</h2>

      <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
        <p className="text-sm font-semibold text-slate-900">Share links</p>
        <button
          type="button"
          onClick={createShare}
          disabled={busy}
          className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
        >
          Create 30-day link
        </button>
        <div className="space-y-1 text-xs text-slate-600">
          {shareLinks.length === 0 ? (
            <p>No active links.</p>
          ) : (
            shareLinks.map((link) => (
              <div key={link.token} className="flex items-center justify-between gap-2 rounded-lg bg-white p-2">
                <span className="truncate">
                  /galleries/shared/{link.token} {link.expiresAt ? `(expires ${new Date(link.expiresAt).toLocaleDateString()})` : ""}
                </span>
                <button
                  type="button"
                  onClick={() => revokeShare(link.token)}
                  className="rounded bg-rose-700 px-2 py-1 text-[11px] font-semibold text-white"
                >
                  Revoke
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
        <p className="text-sm font-semibold text-slate-900">Team members</p>
        <div className="flex gap-2">
          <input
            value={memberEmail}
            onChange={(event) => setMemberEmail(event.target.value)}
            placeholder="member@email.com"
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          />
          <select
            value={memberRole}
            onChange={(event) => setMemberRole(event.target.value as "viewer" | "editor")}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            <option value="viewer">viewer</option>
            <option value="editor">editor</option>
          </select>
          <button
            type="button"
            onClick={addMember}
            disabled={busy}
            className="rounded-lg bg-white px-3 py-2 text-xs font-semibold text-slate-900 ring-1 ring-slate-300 disabled:opacity-50"
          >
            Add
          </button>
        </div>
        <ul className="space-y-1 text-xs text-slate-600">
          {members.map((member) => (
            <li key={member.userId}>
              {member.user.name} ({member.user.email}) - {member.role}
            </li>
          ))}
        </ul>
      </div>

      {itemImageIds.length > 0 ? (
        <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <p className="text-sm font-semibold text-slate-900">Quick remove items</p>
          <div className="flex flex-wrap gap-1">
            {itemImageIds.map((imageId) => (
              <button
                key={imageId}
                type="button"
                onClick={() => removeImage(imageId)}
                className="rounded-full bg-white px-2 py-1 text-[11px] text-slate-700 ring-1 ring-slate-300 hover:bg-slate-100"
              >
                Remove {imageId.slice(0, 8)}...
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {status ? <p className="text-xs text-slate-600">{status}</p> : null}
    </section>
  );
}
