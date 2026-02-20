import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { ImageCard } from "@/components/ImageCard";
import { getEvents, searchCatalog } from "@/lib/catalog-service";
import { getPolicyMap, resolveEventAccess } from "@/lib/event-visibility";
import {
  absoluteUrl,
  cityLabelFromSlug,
  LUXURY_CITIES,
  LUXURY_VERTICALS,
  verticalLabelFromSlug,
} from "@/lib/seo";
import { getServerSession } from "@/lib/session";

type PageProps = {
  params: Promise<{ city: string; vertical: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const resolved = await params;
  const validCity = LUXURY_CITIES.some((city) => city.slug === resolved.city);
  const validVertical = LUXURY_VERTICALS.some((vertical) => vertical.slug === resolved.vertical);
  if (!validCity || !validVertical) {
    return { title: "Luxury Hub Not Found", robots: { index: false, follow: false } };
  }

  const city = cityLabelFromSlug(resolved.city);
  const vertical = verticalLabelFromSlug(resolved.vertical);
  return {
    title: `${city} ${vertical} Photos`,
    description: `Discover and license ${vertical.toLowerCase()} event/editorial imagery in ${city}.`,
    alternates: { canonical: absoluteUrl(`/luxury/${resolved.city}/${resolved.vertical}`) },
  };
}

export function generateStaticParams() {
  return LUXURY_CITIES.flatMap((city) =>
    LUXURY_VERTICALS.map((vertical) => ({ city: city.slug, vertical: vertical.slug })),
  );
}

export default async function LuxuryVerticalPage({ params }: PageProps) {
  const resolved = await params;
  const validCity = LUXURY_CITIES.some((city) => city.slug === resolved.city);
  const validVertical = LUXURY_VERTICALS.some((vertical) => vertical.slug === resolved.vertical);
  if (!validCity || !validVertical) notFound();

  const city = cityLabelFromSlug(resolved.city);
  const vertical = verticalLabelFromSlug(resolved.vertical);
  const session = await getServerSession();
  const cookieStore = await cookies();
  const events = await getEvents();
  const policyMap = await getPolicyMap(events.map((event) => event.eventSlug));
  const visibleEventSlugs = events
    .filter(
      (event) =>
        resolveEventAccess({
          eventSlug: event.eventSlug,
          policy: policyMap.get(event.eventSlug),
          session,
          cookieStore,
        }) === "open",
    )
    .map((event) => event.eventSlug);

  const images = await searchCatalog({
    query: `${city} ${vertical}`,
    allowedEventSlugs: visibleEventSlugs,
  });
  const hubJsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: `${city} ${vertical} Photo Hub`,
    url: absoluteUrl(`/luxury/${resolved.city}/${resolved.vertical}`),
    description: `Curated ${vertical.toLowerCase()} imagery from ${city}.`,
  };

  return (
    <div className="space-y-6">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(hubJsonLd) }}
      />
      <header className="rounded-2xl border border-slate-200 bg-white p-6">
        <p className="text-xs uppercase tracking-wide text-slate-500">Luxury vertical hub</p>
        <h1 className="text-3xl font-semibold text-slate-900">
          {city} - {vertical}
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          Premium coverage curated for buyer licensing and attendee discovery.
        </p>
        <Link href="/luxury" className="mt-3 inline-block text-sm font-medium text-blue-700 hover:underline">
          Back to luxury hubs
        </Link>
      </header>

      {images.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
          No published matches yet for this luxury niche.
        </p>
      ) : (
        <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {images.map((image) => (
            <ImageCard key={image.id} image={image} />
          ))}
        </section>
      )}
    </div>
  );
}
