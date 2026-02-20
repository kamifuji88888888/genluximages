import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getServerSession } from "@/lib/session";

export default async function GalleriesPage() {
  const session = await getServerSession();
  if (!session) redirect("/login?next=/galleries");

  const user = await db.user.findUnique({
    where: { email: session.email.toLowerCase() },
    select: { id: true },
  });
  if (!user) redirect("/login?next=/galleries");

  const galleries = await db.savedGallery.findMany({
    where: {
      OR: [{ ownerId: user.id }, { members: { some: { userId: user.id } } }],
    },
    include: {
      owner: { select: { name: true } },
      _count: { select: { items: true, members: true } },
    },
    orderBy: { updatedAt: "desc" },
  });

  return (
    <div className="space-y-5">
      <header className="rounded-2xl border border-slate-200 bg-white p-5">
        <p className="text-xs uppercase tracking-wide text-slate-500">Viewer tools</p>
        <h1 className="text-3xl font-semibold text-slate-900">Saved Galleries</h1>
        <p className="mt-1 text-sm text-slate-600">
          Keep private picks, build team selects, and publish shared links to external viewers.
        </p>
      </header>

      {galleries.length === 0 ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
          No saved galleries yet. Open any image and use <span className="font-semibold">Saved galleries</span>{" "}
          to create one.
        </section>
      ) : (
        <section className="grid gap-3 md:grid-cols-2">
          {galleries.map((gallery) => (
            <article key={gallery.id} className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">{gallery.mode}</p>
              <h2 className="text-xl font-semibold text-slate-900">{gallery.name}</h2>
              <p className="mt-1 text-sm text-slate-600">{gallery.description || "No description yet."}</p>
              <p className="mt-2 text-xs text-slate-500">
                Owner: {gallery.owner.name} · {gallery._count.items} items · {gallery._count.members} members
              </p>
              <Link
                href={`/galleries/${gallery.id}`}
                className="mt-3 inline-block rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
              >
                Open gallery
              </Link>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
