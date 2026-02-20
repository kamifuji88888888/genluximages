import Image from "next/image";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { logPresetAudit } from "@/lib/preset-audit";
import { getServerSession } from "@/lib/session";

type ReviewPageProps = {
  searchParams?: Promise<{ key?: string }>;
};

async function submitReview(formData: FormData) {
  "use server";

  const session = await getServerSession();
  const key = formData.get("key")?.toString() ?? "";
  const imageId = formData.get("imageId")?.toString() ?? "";
  const action = formData.get("action")?.toString() ?? "";
  const reviewNote = formData.get("reviewNote")?.toString().trim() ?? "";
  const expectedKey = process.env.ADMIN_REVIEW_KEY ?? "";

  if (!expectedKey || key !== expectedKey || !imageId || session?.role !== "ADMIN") return;
  if (action !== "publish" && action !== "reject") return;

  await db.imageAsset.update({
    where: { id: imageId },
    data: {
      status: action === "publish" ? "published" : "archived",
      reviewNote: reviewNote || null,
      reviewedAt: new Date(),
      publishedAt: action === "publish" ? new Date() : null,
    },
  });

  revalidatePath("/admin/review");
  revalidatePath("/");
}

async function submitPresetModeration(formData: FormData) {
  "use server";

  const session = await getServerSession();
  const key = formData.get("key")?.toString() ?? "";
  const presetId = formData.get("presetId")?.toString() ?? "";
  const action = formData.get("action")?.toString() ?? "";
  const expectedKey = process.env.ADMIN_REVIEW_KEY ?? "";

  if (!expectedKey || key !== expectedKey || !presetId || session?.role !== "ADMIN") return;

  const preset = await db.uploadPreset.findUnique({ where: { id: presetId } });
  if (!preset) return;

  if (action === "approve_read_only") {
    const updated = await db.uploadPreset.update({
      where: { id: presetId },
      data: {
        scope: "team",
        isShared: true,
        isReadOnly: true,
        approvedById: (await db.user.findUnique({
          where: { email: session.email.toLowerCase() },
          select: { id: true },
        }))?.id ?? null,
      },
    });
    const actor = await db.user.findUnique({
      where: { email: session.email.toLowerCase() },
      select: { id: true },
    });
    if (actor?.id) {
      await logPresetAudit({
        presetId: updated.id,
        presetName: updated.name,
        action: "approved_read_only",
        actorId: actor.id,
        detail: "Approved in admin moderation queue",
      });
    }
  }

  if (action === "unlock_editable") {
    const updated = await db.uploadPreset.update({
      where: { id: presetId },
      data: {
        isReadOnly: false,
        approvedById: null,
      },
    });
    const actor = await db.user.findUnique({
      where: { email: session.email.toLowerCase() },
      select: { id: true },
    });
    if (actor?.id) {
      await logPresetAudit({
        presetId: updated.id,
        presetName: updated.name,
        action: "updated",
        actorId: actor.id,
        detail: "Read-only lock removed by admin",
      });
    }
  }

  if (action === "make_personal_private") {
    const updated = await db.uploadPreset.update({
      where: { id: presetId },
      data: { scope: "personal", isShared: false },
    });
    const actor = await db.user.findUnique({
      where: { email: session.email.toLowerCase() },
      select: { id: true },
    });
    if (actor?.id) {
      await logPresetAudit({
        presetId: updated.id,
        presetName: updated.name,
        action: "updated",
        actorId: actor.id,
        detail: "Preset moved to personal/private by admin",
      });
    }
  }

  revalidatePath("/admin/review");
  revalidatePath("/upload");
}

export default async function AdminReviewPage({ searchParams }: ReviewPageProps) {
  const session = await getServerSession();
  const params = await searchParams;
  const providedKey = params?.key ?? "";
  const expectedKey = process.env.ADMIN_REVIEW_KEY ?? "";
  const authorized =
    expectedKey.length > 0 && providedKey === expectedKey && session?.role === "ADMIN";

  if (!authorized) {
    return (
      <div className="mx-auto max-w-3xl rounded-2xl border border-amber-300 bg-amber-50 p-6">
        <p className="text-xs uppercase tracking-wide text-amber-800">Admin access required</p>
        <h1 className="mt-1 text-2xl font-semibold text-amber-900">Review Queue Locked</h1>
        <p className="mt-2 text-sm text-amber-900">
          Sign in as an admin, then open this page with your admin key query parameter:
          <code className="ml-1">/admin/review?key=YOUR_ADMIN_REVIEW_KEY</code>
        </p>
        <p className="mt-2 text-sm text-amber-900">
          <a href="/login?next=/admin/review" className="underline">
            Go to login
          </a>
        </p>
      </div>
    );
  }

  const [pending, recentReviews, presets, recentPresetAudits] = await Promise.all([
    db.imageAsset.findMany({
      where: { status: "pending" },
      include: { photographer: { select: { name: true, email: true } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    db.imageAsset.findMany({
      where: { status: { in: ["published", "archived"] } },
      include: { photographer: { select: { name: true } } },
      orderBy: { reviewedAt: "desc" },
      take: 10,
    }),
    db.uploadPreset.findMany({
      include: {
        createdBy: { select: { name: true, email: true } },
        approvedBy: { select: { name: true, email: true } },
      },
      orderBy: [{ isReadOnly: "desc" }, { updatedAt: "desc" }],
      take: 30,
    }),
    db.uploadPresetAudit.findMany({
      include: { actor: { select: { name: true, email: true } } },
      orderBy: { createdAt: "desc" },
      take: 12,
    }),
  ]);

  return (
    <div className="space-y-6">
      <header className="rounded-2xl border border-slate-200 bg-white p-6">
        <p className="text-xs uppercase tracking-wide text-slate-500">Admin moderation</p>
        <h1 className="text-3xl font-semibold text-slate-900">Image Review Queue</h1>
        <p className="mt-2 text-sm text-slate-600">
          Approve photos to publish them in marketplace search, or reject them with notes.
        </p>
      </header>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-slate-900">Pending submissions ({pending.length})</h2>
        {pending.length === 0 ? (
          <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
            No pending submissions.
          </p>
        ) : (
          pending.map((asset) => (
            <article key={asset.id} className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="grid gap-4 md:grid-cols-[220px_1fr]">
                <Image
                  src={asset.previewUrl}
                  alt={asset.title}
                  width={220}
                  height={140}
                  className="h-36 w-full rounded-xl object-cover"
                />
                <div className="space-y-2">
                  <h3 className="text-lg font-semibold text-slate-900">{asset.title}</h3>
                  <p className="text-sm text-slate-600">
                    {asset.eventName} ({asset.eventSlug}) - {asset.location}
                  </p>
                  <p className="text-sm text-slate-600">
                    Photographer: {asset.photographer.name} ({asset.photographer.email})
                  </p>
                  <p className="text-xs text-slate-500">
                    File: {asset.filename} | Rights: {asset.usageRights} | ${asset.priceUsd}
                  </p>
                  <p className="text-xs text-slate-500">
                    Attendee keywords: {asset.attendeeKeywords || "none"}
                  </p>

                  <form action={submitReview} className="grid gap-2 pt-2 md:grid-cols-3">
                    <input type="hidden" name="key" value={providedKey} />
                    <input type="hidden" name="imageId" value={asset.id} />
                    <textarea
                      name="reviewNote"
                      placeholder="Optional review note"
                      className="rounded-xl border border-slate-300 px-3 py-2 text-sm md:col-span-3"
                      rows={2}
                    />
                    <button
                      type="submit"
                      name="action"
                      value="publish"
                      className="rounded-xl bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-600"
                    >
                      Approve & Publish
                    </button>
                    <button
                      type="submit"
                      name="action"
                      value="reject"
                      className="rounded-xl bg-rose-700 px-3 py-2 text-sm font-semibold text-white hover:bg-rose-600"
                    >
                      Reject
                    </button>
                  </form>
                </div>
              </div>
            </article>
          ))
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="text-lg font-semibold text-slate-900">Recent decisions</h2>
        <ul className="mt-3 space-y-2 text-sm text-slate-700">
          {recentReviews.map((asset) => (
            <li key={asset.id}>
              {asset.title} - <span className="font-medium">{asset.status}</span> by{" "}
              {asset.photographer.name}
              {asset.reviewNote ? ` (${asset.reviewNote})` : ""}
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="text-lg font-semibold text-slate-900">Preset Moderation Queue</h2>
        <p className="mt-1 text-sm text-slate-600">
          Approve shared team presets as read-only templates, or unlock them for editing.
        </p>
        <div className="mt-3 space-y-2">
          {presets.map((preset) => (
            <article key={preset.id} className="rounded-xl border border-slate-200 p-3">
              <p className="text-sm font-semibold text-slate-900">
                [{preset.folder}] {preset.name}
              </p>
              <p className="text-xs text-slate-600">
                scope: {preset.scope} · shared: {String(preset.isShared)} · read-only:{" "}
                {String(preset.isReadOnly)}
              </p>
              <p className="text-xs text-slate-600">
                owner: {preset.createdBy.name} ({preset.createdBy.email})
                {preset.approvedBy ? ` · approved by ${preset.approvedBy.name}` : ""}
              </p>
              <form action={submitPresetModeration} className="mt-2 flex flex-wrap gap-2">
                <input type="hidden" name="key" value={providedKey} />
                <input type="hidden" name="presetId" value={preset.id} />
                <button
                  type="submit"
                  name="action"
                  value="approve_read_only"
                  className="rounded-lg bg-emerald-700 px-2.5 py-1.5 text-xs font-semibold text-white"
                >
                  Approve Read-Only Team
                </button>
                <button
                  type="submit"
                  name="action"
                  value="unlock_editable"
                  className="rounded-lg bg-amber-600 px-2.5 py-1.5 text-xs font-semibold text-white"
                >
                  Unlock Editable
                </button>
                <button
                  type="submit"
                  name="action"
                  value="make_personal_private"
                  className="rounded-lg bg-slate-700 px-2.5 py-1.5 text-xs font-semibold text-white"
                >
                  Move to Personal/Private
                </button>
              </form>
            </article>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="text-lg font-semibold text-slate-900">Recent Preset Activity</h2>
        <ul className="mt-2 space-y-1 text-sm text-slate-700">
          {recentPresetAudits.map((entry) => (
            <li key={entry.id}>
              {entry.action} · {entry.presetName} · {entry.actor.name} ·{" "}
              {new Date(entry.createdAt).toLocaleString()}
              {entry.detail ? ` (${entry.detail})` : ""}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
