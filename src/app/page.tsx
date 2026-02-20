import Link from "next/link";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { ImageCard } from "@/components/ImageCard";
import { getEvents, searchCatalog } from "@/lib/catalog-service";
import { getPolicyMap, resolveEventAccess } from "@/lib/event-visibility";
import { absoluteUrl, LUXURY_CITIES, LUXURY_VERTICALS } from "@/lib/seo";
import { getServerSession } from "@/lib/session";

type HomeProps = {
  searchParams?: Promise<{
    q?: string;
    event?: string;
    rights?: "all" | "editorial" | "commercial";
  }>;
};

export async function generateMetadata({ searchParams }: HomeProps): Promise<Metadata> {
  const resolved = await searchParams;
  const query = resolved?.q?.trim() ?? "";
  const event = resolved?.event?.trim() ?? "";
  const rights = resolved?.rights ?? "all";
  const hasFilters = query.length > 0 || event.length > 0 || rights !== "all";

  return {
    title: hasFilters
      ? `${query || event || "Search"} Luxury Photo Results`
      : "Luxury Event & Editorial Image Licensing",
    description: hasFilters
      ? "Search GENLUXIMAGES for premium Los Angeles and New York event/editorial imagery."
      : "License luxury-first event and editorial photography in Los Angeles and New York across fashion, beauty, cars, yachts, watches, and private aviation.",
    alternates: {
      canonical: hasFilters ? absoluteUrl("/") : absoluteUrl("/"),
    },
    robots: hasFilters
      ? { index: false, follow: true }
      : { index: true, follow: true },
  };
}

export default async function Home({ searchParams }: HomeProps) {
  const session = await getServerSession();
  const cookieStore = await cookies();
  const resolvedSearchParams = await searchParams;
  const query = resolvedSearchParams?.q ?? "";
  const selectedEvent = resolvedSearchParams?.event ?? "";
  const rights = resolvedSearchParams?.rights ?? "all";

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
  const visibleEvents = events.filter((event) => visibleEventSlugs.includes(event.eventSlug));
  const selectedEventState =
    selectedEvent &&
    resolveEventAccess({
      eventSlug: selectedEvent,
      policy: policyMap.get(selectedEvent),
      session,
      cookieStore,
    });

  const images = await searchCatalog({
    query,
    eventSlug: selectedEvent || undefined,
    rights,
    allowedEventSlugs: visibleEventSlugs,
  });
  const homeCollectionJsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "GENLUXIMAGES Luxury Photo Search",
    url: absoluteUrl("/"),
    description:
      "Discover and license luxury event and editorial imagery for Los Angeles and New York.",
    about: [
      "Fashion events",
      "Beauty editorials",
      "Luxury cars",
      "Yachts",
      "Watches",
      "Private jets",
    ],
  };

  return (
    <div className="space-y-8">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(homeCollectionJsonLd) }}
      />
      <section className="rounded-3xl bg-gradient-to-r from-slate-950 to-slate-700 p-7 text-white">
        <p className="mb-2 text-xs uppercase tracking-[0.24em] text-slate-300">
          Editorial + Event Photography
        </p>
        <h1 className="text-3xl font-semibold md:text-4xl">
          Search and license luxury imagery, fast.
        </h1>
        <p className="mt-3 max-w-3xl text-sm text-slate-200">
          Built for photographers, newsrooms, and attendees who need premium, discoverable coverage.
        </p>
        <div className="mt-4">
          <Link
            href="/attendee"
            className="inline-block rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-900"
          >
            Open Attendee Quick Portal
          </Link>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="text-xl font-semibold text-slate-900">Luxury Market Hubs</h2>
        <p className="mt-1 text-sm text-slate-600">
          Explore curated luxury coverage by city and vertical for buyer research and attendee discovery.
        </p>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {LUXURY_CITIES.map((city) => (
            <div key={city.slug} className="rounded-xl border border-slate-200 p-3">
              <p className="text-sm font-semibold text-slate-900">{city.label}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {LUXURY_VERTICALS.map((vertical) => (
                  <Link
                    key={`${city.slug}-${vertical.slug}`}
                    href={`/luxury/${city.slug}/${vertical.slug}`}
                    className="rounded-full border border-slate-300 px-2.5 py-1 text-xs hover:bg-slate-50"
                  >
                    {vertical.label}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <form className="grid gap-3 md:grid-cols-4">
          <input
            name="q"
            defaultValue={query}
            placeholder="Search by event, filename, photographer, or tag..."
            className="rounded-xl border border-slate-300 px-3 py-2 text-sm md:col-span-2"
          />
          <select
            name="event"
            defaultValue={selectedEvent}
            className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">All events</option>
            {visibleEvents.map((event) => (
              <option key={event.eventSlug} value={event.eventSlug}>
                {event.eventName}
              </option>
            ))}
          </select>
          <select
            name="rights"
            defaultValue={rights}
            className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="all">All rights</option>
            <option value="editorial">Editorial</option>
            <option value="commercial">Commercial</option>
          </select>
          <button
            type="submit"
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 md:col-span-4"
          >
            Search catalog
          </button>
        </form>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-slate-900">Featured Events</h2>
          <div className="flex flex-wrap gap-2 text-xs">
            {visibleEvents.map((event) => (
              <Link
                key={event.eventSlug}
                href={`/events/${event.eventSlug}`}
                className="rounded-full border border-slate-300 px-3 py-1 hover:bg-slate-50"
              >
                {event.eventName} ({event.count})
              </Link>
            ))}
          </div>
        </div>

        {selectedEventState && selectedEventState !== "open" ? (
          <p className="rounded-xl border border-amber-300 bg-amber-50 p-6 text-center text-sm text-amber-800">
            This event is restricted. Use the attendee or agency portal to unlock access.
          </p>
        ) : images.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
            No matches found. Try a different keyword or rights filter.
          </p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {images.map((image) => (
              <ImageCard key={image.id} image={image} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
