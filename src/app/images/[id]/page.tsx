import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { AddToCartButton } from "@/components/AddToCartButton";
import { SaveToGalleryButton } from "@/components/SaveToGalleryButton";
import { getImageById } from "@/lib/catalog-service";
import { getPolicyMap, resolveEventAccess } from "@/lib/event-visibility";
import { absoluteUrl } from "@/lib/seo";
import { getServerSession } from "@/lib/session";

type ImagePageProps = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata({ params }: ImagePageProps): Promise<Metadata> {
  const resolved = await params;
  const image = await getImageById(resolved.id);
  if (!image) {
    return {
      title: "Image Not Found",
      robots: { index: false, follow: false },
    };
  }

  return {
    title: `${image.title} | ${image.eventName}`,
    description: `License ${image.title} from ${image.eventName} on GENLUXIMAGES.`,
    alternates: { canonical: absoluteUrl(`/images/${image.id}`) },
    openGraph: {
      type: "article",
      url: absoluteUrl(`/images/${image.id}`),
      title: `${image.title} | ${image.eventName}`,
      description: `Editorial and commercial licensing for ${image.title}.`,
      images: [{ url: image.previewUrl, alt: image.title }],
    },
    twitter: {
      card: "summary_large_image",
      title: `${image.title} | ${image.eventName}`,
      description: `License ${image.title} via GENLUXIMAGES.`,
      images: [image.previewUrl],
    },
  };
}

export default async function ImagePage({ params }: ImagePageProps) {
  const session = await getServerSession();
  const cookieStore = await cookies();
  const resolved = await params;
  const image = await getImageById(resolved.id);
  if (!image) notFound();
  const policyMap = await getPolicyMap([image.eventSlug]);
  const access = resolveEventAccess({
    eventSlug: image.eventSlug,
    policy: policyMap.get(image.eventSlug),
    session,
    cookieStore,
  });
  if (access !== "open") {
    return (
      <div className="mx-auto max-w-3xl rounded-2xl border border-amber-300 bg-amber-50 p-6">
        <p className="text-xs uppercase tracking-wide text-amber-800">Restricted image</p>
        <h1 className="mt-1 text-2xl font-semibold text-amber-900">{image.title}</h1>
        <p className="mt-2 text-sm text-amber-900">
          This image is in a {access} gallery. Unlock event access to view licensing details.
        </p>
        <Link
          href={`/unlock?event=${image.eventSlug}&next=/images/${image.id}`}
          className="mt-3 inline-block rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
        >
          Unlock gallery
        </Link>
      </div>
    );
  }
  const imageJsonLd = {
    "@context": "https://schema.org",
    "@type": "ImageObject",
    name: image.title,
    description: `${image.eventName} - ${image.location}`,
    contentUrl: absoluteUrl(`/images/${image.id}`),
    thumbnailUrl: image.previewUrl,
    creator: {
      "@type": "Person",
      name: image.photographer,
    },
    uploadDate: image.capturedAt,
    keywords: image.tags.join(", "),
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1.8fr_1fr]">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(imageJsonLd) }}
      />
      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white">
        <Image
          src={image.previewUrl}
          alt={image.title}
          width={1440}
          height={900}
          className="h-[70vh] w-full object-cover"
        />
      </section>

      <aside className="space-y-4 rounded-3xl border border-slate-200 bg-white p-5">
        <p className="text-xs uppercase tracking-wide text-slate-500">{image.eventName}</p>
        <h1 className="text-2xl font-semibold text-slate-900">{image.title}</h1>
        <p className="text-sm text-slate-600">{image.location}</p>
        <p className="text-sm text-slate-600">
          By {image.photographer} on {new Date(image.capturedAt).toLocaleString()}
        </p>
        <p className="text-sm text-slate-600">Filename: {image.filename}</p>
        <div className="flex flex-wrap gap-2">
          {image.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-700"
            >
              #{tag}
            </span>
          ))}
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <p className="text-sm text-slate-700">Usage rights: {image.usageRights}</p>
          <p className="text-lg font-semibold text-slate-900">${image.priceUsd} license fee</p>
        </div>

        <AddToCartButton
          item={{
            imageId: image.id,
            title: image.title,
            priceUsd: image.priceUsd,
            previewUrl: image.previewUrl,
          }}
        />
        <SaveToGalleryButton imageId={image.id} isLoggedIn={Boolean(session)} />

        <Link href="/cart" className="block text-sm font-medium text-blue-700 hover:underline">
          Go to cart
        </Link>
      </aside>
    </div>
  );
}
