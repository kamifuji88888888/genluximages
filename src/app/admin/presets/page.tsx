import Link from "next/link";
import { db } from "@/lib/db";
import { getServerSession } from "@/lib/session";
import { AdminPresetDashboard } from "@/components/AdminPresetDashboard";

type PageProps = {
  searchParams?: Promise<{ key?: string }>;
};

export default async function AdminPresetsPage({ searchParams }: PageProps) {
  const session = await getServerSession();
  const params = await searchParams;
  const providedKey = params?.key ?? "";
  const expectedKey = process.env.ADMIN_REVIEW_KEY ?? "";
  const authorized = expectedKey.length > 0 && providedKey === expectedKey && session?.role === "ADMIN";

  if (!authorized) {
    return (
      <div className="mx-auto max-w-3xl rounded-2xl border border-amber-300 bg-amber-50 p-6">
        <p className="text-xs uppercase tracking-wide text-amber-800">Admin access required</p>
        <h1 className="mt-1 text-2xl font-semibold text-amber-900">Preset Dashboard Locked</h1>
        <p className="mt-2 text-sm text-amber-900">
          Sign in as admin and open <code className="ml-1">/admin/presets?key=YOUR_ADMIN_REVIEW_KEY</code>.
        </p>
        <p className="mt-2 text-sm text-amber-900">
          <Link href="/login?next=/admin/presets" className="underline">
            Go to login
          </Link>
        </p>
      </div>
    );
  }

  const presets = await db.uploadPreset.findMany({
    include: {
      createdBy: { select: { name: true, email: true } },
      approvedBy: { select: { name: true, email: true } },
    },
    orderBy: [{ folder: "asc" }, { updatedAt: "desc" }],
  });

  return (
    <div className="space-y-4">
      <header className="rounded-2xl border border-slate-200 bg-white p-5">
        <p className="text-xs uppercase tracking-wide text-slate-500">Admin governance</p>
        <h1 className="text-3xl font-semibold text-slate-900">Preset Dashboard</h1>
        <p className="mt-1 text-sm text-slate-600">
          Filter by folder, scope, owner, and read-only status. Run bulk moderation in one pass.
        </p>
      </header>
      <AdminPresetDashboard
        presets={presets.map((preset) => ({
          id: preset.id,
          name: preset.name,
          folder: preset.folder,
          scope: preset.scope,
          isShared: preset.isShared,
          isReadOnly: preset.isReadOnly,
          createdBy: preset.createdBy,
          approvedBy: preset.approvedBy,
          updatedAt: preset.updatedAt.toISOString(),
        }))}
      />
    </div>
  );
}
