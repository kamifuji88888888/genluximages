import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { GalleryManager } from "@/components/GalleryManager";
import { getServerSession } from "@/lib/session";

type PageProps = { params: Promise<{ id: string }> };

export default async function GalleryDetailPage({ params }: PageProps) {
  const session = await getServerSession();
  if (!session) redirect("/login");
  const resolved = await params;

  const user = await db.user.findUnique({
    where: { email: session.email.toLowerCase() },
    select: { id: true, role: true },
  });
  if (!user) redirect("/login");

  const gallery = await db.savedGallery.findUnique({
    where: { id: resolved.id },
    include: {
      owner: { select: { id: true, name: true, email: true } },
      members: { include: { user: { select: { id: true, name: true, email: true } } } },
      shareLinks: {
        where: { isActive: true },
        select: { token: true, expiresAt: true },
        orderBy: { createdAt: "desc" },
      },
      items: {
        include: {
          image: {
            select: {
              id: true,
              title: true,
              previewUrl: true,
              priceUsd: true,
              eventName: true,
            },
          },
        },
        orderBy: { addedAt: "desc" },
      },
    },
  });

  if (!gallery) {
    return <p className="text-sm text-slate-600">Gallery not found.</p>;
  }

  const isMember = gallery.members.some((entry) => entry.userId === user.id);
  const canView = gallery.ownerId === user.id || isMember;
  if (!canView) {
    return <p className="text-sm text-slate-600">You do not have access to this gallery.</p>;
  }
  const canManage = gallery.ownerId === user.id || user.role === "ADMIN";

  return (
    <div className="space-y-5">
      <header className="rounded-2xl border border-slate-200 bg-white p-5">
        <p className="text-xs uppercase tracking-wide text-slate-500">{gallery.mode}</p>
        <h1 className="text-3xl font-semibold text-slate-900">{gallery.name}</h1>
        <p className="mt-1 text-sm text-slate-600">{gallery.description || "No description yet."}</p>
        <p className="mt-2 text-xs text-slate-500">
          Owner: {gallery.owner.name} ({gallery.owner.email})
        </p>
      </header>

      <GalleryManager
        galleryId={gallery.id}
        canManage={canManage}
        members={gallery.members.map((member) => ({
          userId: member.userId,
          role: member.role,
          user: member.user,
        }))}
        shareLinks={gallery.shareLinks.map((link) => ({
          token: link.token,
          expiresAt: link.expiresAt?.toISOString() ?? null,
        }))}
        itemImageIds={gallery.items.map((entry) => entry.image.id)}
      />

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {gallery.items.length === 0 ? (
          <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
            No images saved in this gallery yet.
          </p>
        ) : (
          gallery.items.map((entry) => (
            <article key={entry.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <Image
                src={entry.image.previewUrl}
                alt={entry.image.title}
                width={640}
                height={420}
                className="h-44 w-full object-cover"
              />
              <div className="space-y-1 p-3">
                <p className="text-sm font-semibold text-slate-900">{entry.image.title}</p>
                <p className="text-xs text-slate-500">{entry.image.eventName}</p>
                <p className="text-sm font-medium text-slate-800">${entry.image.priceUsd}</p>
                <Link href={`/images/${entry.image.id}`} className="text-xs font-semibold text-blue-700 hover:underline">
                  View image
                </Link>
              </div>
            </article>
          ))
        )}
      </section>
    </div>
  );
}
