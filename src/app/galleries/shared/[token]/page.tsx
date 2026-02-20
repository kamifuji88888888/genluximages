import Link from "next/link";
import Image from "next/image";
import { db } from "@/lib/db";

type PageProps = { params: Promise<{ token: string }> };

export default async function SharedGalleryPage({ params }: PageProps) {
  const resolved = await params;
  const link = await db.savedGalleryShareLink.findFirst({
    where: { token: resolved.token, isActive: true },
    include: {
      gallery: {
        include: {
          owner: { select: { name: true } },
          items: {
            include: {
              image: {
                select: { id: true, title: true, previewUrl: true, eventName: true, priceUsd: true },
              },
            },
            orderBy: { addedAt: "desc" },
          },
        },
      },
    },
  });

  if (!link) {
    return <p className="text-sm text-slate-600">This shared gallery link is invalid.</p>;
  }

  return (
    <div className="space-y-4">
      <header className="rounded-2xl border border-slate-200 bg-white p-5">
        <p className="text-xs uppercase tracking-wide text-slate-500">Shared gallery</p>
        <h1 className="text-3xl font-semibold text-slate-900">{link.gallery.name}</h1>
        <p className="text-sm text-slate-600">
          Curated by {link.gallery.owner.name} · {link.gallery.items.length} images
        </p>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {link.gallery.items.map((entry) => (
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
                License this image
              </Link>
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
