"use client";

import { useMemo, useState } from "react";

type PresetRow = {
  id: string;
  name: string;
  folder: string;
  scope: "personal" | "team";
  isShared: boolean;
  isReadOnly: boolean;
  createdBy: { name: string; email: string };
  approvedBy: { name: string; email: string } | null;
  updatedAt: string;
};

type Props = {
  presets: PresetRow[];
};

type BulkAction = "approve_read_only" | "unlock_editable" | "make_personal_private" | "delete";

export function AdminPresetDashboard({ presets }: Props) {
  const [selected, setSelected] = useState<string[]>([]);
  const [folderFilter, setFolderFilter] = useState("all");
  const [scopeFilter, setScopeFilter] = useState("all");
  const [ownerFilter, setOwnerFilter] = useState("");
  const [readOnlyFilter, setReadOnlyFilter] = useState("all");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const folders = useMemo(
    () => ["all", ...Array.from(new Set(presets.map((preset) => preset.folder))).sort()],
    [presets],
  );

  const filtered = useMemo(
    () =>
      presets.filter((preset) => {
        if (folderFilter !== "all" && preset.folder !== folderFilter) return false;
        if (scopeFilter !== "all" && preset.scope !== scopeFilter) return false;
        if (readOnlyFilter === "readonly" && !preset.isReadOnly) return false;
        if (readOnlyFilter === "editable" && preset.isReadOnly) return false;
        if (ownerFilter.trim()) {
          const needle = ownerFilter.trim().toLowerCase();
          const hay = `${preset.createdBy.name} ${preset.createdBy.email}`.toLowerCase();
          if (!hay.includes(needle)) return false;
        }
        return true;
      }),
    [folderFilter, ownerFilter, presets, readOnlyFilter, scopeFilter],
  );

  const toggle = (id: string) => {
    setSelected((current) =>
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id],
    );
  };

  const runBulkAction = async (action: BulkAction) => {
    if (!selected.length) {
      setStatus("Select at least one preset.");
      return;
    }
    setBusy(true);
    setStatus("");
    try {
      const response = await fetch("/api/upload/presets/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selected, action }),
      });
      const data = (await response.json()) as { ok: boolean; message?: string; updatedCount?: number };
      setStatus(
        data.ok
          ? `Bulk action applied to ${data.updatedCount ?? selected.length} presets. Refresh to see latest state.`
          : (data.message ?? "Bulk action failed."),
      );
      if (data.ok) setSelected([]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="grid gap-2 md:grid-cols-4">
          <select
            value={folderFilter}
            onChange={(event) => setFolderFilter(event.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            {folders.map((folder) => (
              <option key={folder} value={folder}>
                Folder: {folder}
              </option>
            ))}
          </select>
          <select
            value={scopeFilter}
            onChange={(event) => setScopeFilter(event.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="all">Scope: all</option>
            <option value="team">Scope: team</option>
            <option value="personal">Scope: personal</option>
          </select>
          <select
            value={readOnlyFilter}
            onChange={(event) => setReadOnlyFilter(event.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="all">Read-only: all</option>
            <option value="readonly">Read-only only</option>
            <option value="editable">Editable only</option>
          </select>
          <input
            value={ownerFilter}
            onChange={(event) => setOwnerFilter(event.target.value)}
            placeholder="Filter owner name/email"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => runBulkAction("approve_read_only")}
            className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
          >
            Approve Read-Only Team
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => runBulkAction("unlock_editable")}
            className="rounded-lg bg-amber-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
          >
            Unlock Editable
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => runBulkAction("make_personal_private")}
            className="rounded-lg bg-slate-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
          >
            Move to Personal/Private
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => runBulkAction("delete")}
            className="rounded-lg bg-rose-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
          >
            Delete
          </button>
        </div>
        {status ? <p className="mt-2 text-xs text-slate-600">{status}</p> : null}
      </section>

      <section className="space-y-2">
        {filtered.map((preset) => (
          <article key={preset.id} className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={selected.includes(preset.id)}
                onChange={() => toggle(preset.id)}
                className="mt-1 h-4 w-4"
              />
              <div className="space-y-1">
                <p className="text-sm font-semibold text-slate-900">
                  [{preset.folder}] {preset.name}
                </p>
                <p className="text-xs text-slate-600">
                  scope: {preset.scope} · shared: {String(preset.isShared)} · read-only:{" "}
                  {String(preset.isReadOnly)}
                </p>
                <p className="text-xs text-slate-600">
                  owner: {preset.createdBy.name} ({preset.createdBy.email})
                  {preset.approvedBy
                    ? ` · approved by ${preset.approvedBy.name} (${preset.approvedBy.email})`
                    : ""}
                </p>
              </div>
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
