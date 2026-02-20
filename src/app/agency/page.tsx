import Link from "next/link";
import { cookies } from "next/headers";
import { getEvents } from "@/lib/catalog-service";
import { getPolicyMap, resolveEventAccess } from "@/lib/event-visibility";
import { getServerSession } from "@/lib/session";

export default async function AgencyPage() {
  const session = await getServerSession();
  if (!session || (session.role !== "BUYER" && session.role !== "ADMIN")) {
    return (
      <div className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white p-6">
        <p className="text-xs uppercase tracking-wide text-slate-500">Agency portal</p>
        <h1 className="text-2xl font-semibold text-slate-900">Sign in required</h1>
        <p className="mt-2 text-sm text-slate-600">
          Buyer or admin access is required to manage private client galleries.
        </p>
        <Link
          href="/login?next=/agency"
          className="mt-3 inline-block rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
        >
          Sign in as buyer/admin
        </Link>
      </div>
    );
  }

  const eventSummaries = await getEvents();
  const policyMap = await getPolicyMap(eventSummaries.map((event) => event.eventSlug));
  const cookieStore = await cookies();

  return (
    <div className="space-y-5">
      <header className="rounded-2xl border border-slate-200 bg-white p-6">
        <p className="text-xs uppercase tracking-wide text-slate-500">Agency portal</p>
        <h1 className="text-3xl font-semibold text-slate-900">Client Galleries & Embargoes</h1>
        <p className="mt-2 text-sm text-slate-600">
          Logged in as {session.name} ({session.role}). Review event visibility and unlock private
          client galleries.
        </p>
      </header>

      <section className="space-y-3">
        {eventSummaries.map((event) => {
          const policy = policyMap.get(event.eventSlug);
          const state = resolveEventAccess({
            eventSlug: event.eventSlug,
            policy,
            session,
            cookieStore,
          });
          return (
            <article
              key={event.eventSlug}
              className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white p-4"
            >
              <div>
                <h2 className="font-semibold text-slate-900">{event.eventName}</h2>
                <p className="text-sm text-slate-600">
                  {event.count} images · private: {policy?.isPrivate ? "yes" : "no"} · embargo:{" "}
                  {policy?.embargoUntil
                    ? new Date(policy.embargoUntil).toLocaleDateString()
                    : "none"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    state === "open"
                      ? "bg-emerald-100 text-emerald-800"
                      : state === "embargoed"
                        ? "bg-amber-100 text-amber-800"
                        : "bg-rose-100 text-rose-800"
                  }`}
                >
                  {state}
                </span>
                {state !== "open" ? (
                  <Link
                    href={`/unlock?event=${event.eventSlug}&next=/agency`}
                    className="rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white"
                  >
                    Unlock
                  </Link>
                ) : (
                  <Link
                    href={`/events/${event.eventSlug}`}
                    className="rounded-full border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700"
                  >
                    Open gallery
                  </Link>
                )}
              </div>
            </article>
          );
        })}
      </section>
    </div>
  );
}
