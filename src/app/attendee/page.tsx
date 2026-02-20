import Link from "next/link";
import { cookies } from "next/headers";
import { ImageCard } from "@/components/ImageCard";
import { getEvents, searchCatalog } from "@/lib/catalog-service";
import { getPolicyMap, resolveEventAccess } from "@/lib/event-visibility";
import { getServerSession } from "@/lib/session";

type AttendeePageProps = {
  searchParams?: Promise<{ event?: string; q?: string }>;
};

export default async function AttendeePage({ searchParams }: AttendeePageProps) {
  const session = await getServerSession();
  const cookieStore = await cookies();
  const params = await searchParams;
  const selectedEvent = params?.event ?? "";
  const query = params?.q ?? "";

  const events = await getEvents();
  const policyMap = await getPolicyMap(events.map((event) => event.eventSlug));
  const selectedState =
    selectedEvent &&
    resolveEventAccess({
      eventSlug: selectedEvent,
      policy: policyMap.get(selectedEvent),
      session,
      cookieStore,
    });

  const openEventSlugs = events
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

  const images =
    selectedEvent && selectedState === "open"
      ? await searchCatalog({
          eventSlug: selectedEvent,
          query,
          allowedEventSlugs: openEventSlugs,
        })
      : [];

  return (
    <div className="space-y-6">
      <header className="rounded-2xl bg-gradient-to-r from-indigo-900 to-blue-700 p-6 text-white">
        <p className="text-xs uppercase tracking-wide text-indigo-200">Attendee quick access</p>
        <h1 className="text-3xl font-semibold">Find your event photos fast</h1>
        <p className="mt-2 text-sm text-indigo-100">
          Select your event and search by bib number, table, badge, or your photographer provided
          keyword.
        </p>
      </header>

      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <form className="grid gap-3 md:grid-cols-3">
          <select
            name="event"
            defaultValue={selectedEvent}
            className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
            required
          >
            <option value="">Choose event</option>
            {events.map((event) => (
              <option key={event.eventSlug} value={event.eventSlug}>
                {event.eventName}
              </option>
            ))}
          </select>
          <input
            name="q"
            defaultValue={query}
            placeholder="Bib/table/badge/keyword (optional)"
            className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
          />
          <button
            type="submit"
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
          >
            View my photos
          </button>
        </form>
      </section>

      {!selectedEvent ? (
        <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-600">
          Pick an event above to begin.
        </p>
      ) : selectedState && selectedState !== "open" ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-6 text-center text-sm text-amber-900">
          <p>This event is currently {selectedState}. Enter your event code to unlock photos.</p>
          <Link
            href={`/unlock?event=${selectedEvent}&next=/attendee?event=${selectedEvent}`}
            className="mt-3 inline-block rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
          >
            Unlock private gallery
          </Link>
        </div>
      ) : images.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-600">
          No photos found yet. Try another keyword or check back as more galleries are published.
        </p>
      ) : (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm text-slate-600">{images.length} photo matches</p>
            <Link href="/" className="text-sm font-medium text-blue-700 hover:underline">
              Open full marketplace search
            </Link>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {images.map((image) => (
              <ImageCard key={image.id} image={image} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
