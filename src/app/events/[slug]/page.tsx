import Link from "next/link";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { ImageCard } from "@/components/ImageCard";
import { getEvents, searchCatalog } from "@/lib/catalog-service";
import { getPolicyMap, resolveEventAccess } from "@/lib/event-visibility";
import { absoluteUrl } from "@/lib/seo";
import { getServerSession } from "@/lib/session";

type EventPageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({ params }: EventPageProps): Promise<Metadata> {
  const resolved = await params;
  const events = await getEvents();
  const event = events.find((entry) => entry.eventSlug === resolved.slug);
  if (!event) {
    return {
      title: "Event Gallery Not Found",
      robots: { index: false, follow: false },
    };
  }

  return {
    title: `${event.eventName} Photos`,
    description: `Browse and license ${event.eventName} coverage on GENLUXIMAGES.`,
    alternates: { canonical: absoluteUrl(`/events/${event.eventSlug}`) },
    openGraph: {
      type: "website",
      url: absoluteUrl(`/events/${event.eventSlug}`),
      title: `${event.eventName} Photos`,
      description: `Luxury event gallery for ${event.eventName}.`,
    },
  };
}

export default async function EventPage({ params }: EventPageProps) {
  const session = await getServerSession();
  const cookieStore = await cookies();
  const resolved = await params;
  const events = await getEvents();
  const event = events.find((entry) => entry.eventSlug === resolved.slug);
  if (!event) notFound();
  const policyMap = await getPolicyMap([event.eventSlug]);
  const state = resolveEventAccess({
    eventSlug: event.eventSlug,
    policy: policyMap.get(event.eventSlug),
    session,
    cookieStore,
  });
  if (state !== "open") {
    return (
      <div className="mx-auto max-w-3xl rounded-2xl border border-amber-300 bg-amber-50 p-6">
        <p className="text-xs uppercase tracking-wide text-amber-800">Restricted gallery</p>
        <h1 className="mt-1 text-2xl font-semibold text-amber-900">{event.eventName}</h1>
        <p className="mt-2 text-sm text-amber-900">
          This gallery is currently {state}. Unlock event access to continue.
        </p>
        <Link
          href={`/unlock?event=${event.eventSlug}&next=/events/${event.eventSlug}`}
          className="mt-3 inline-block rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
        >
          Unlock gallery
        </Link>
      </div>
    );
  }

  const images = await searchCatalog({ eventSlug: event.eventSlug, allowedEventSlugs: [event.eventSlug] });
  const eventCollectionJsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: `${event.eventName} Photo Gallery`,
    url: absoluteUrl(`/events/${event.eventSlug}`),
    description: `${event.count} catalogued images from ${event.eventName}.`,
    isPartOf: absoluteUrl("/"),
  };

  return (
    <div className="space-y-6">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(eventCollectionJsonLd) }}
      />
      <header className="rounded-2xl border border-slate-200 bg-white p-6">
        <p className="text-xs uppercase tracking-wide text-slate-500">Event gallery</p>
        <h1 className="text-3xl font-semibold text-slate-900">{event.eventName}</h1>
        <p className="mt-1 text-sm text-slate-600">{event.count} catalogued images available.</p>
        <Link href="/" className="mt-3 inline-block text-sm font-medium text-blue-700 hover:underline">
          Back to full search
        </Link>
      </header>

      <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {images.map((image) => (
          <ImageCard key={image.id} image={image} />
        ))}
      </section>
    </div>
  );
}
