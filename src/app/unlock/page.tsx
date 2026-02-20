import { UnlockForm } from "@/components/UnlockForm";

type UnlockPageProps = {
  searchParams?: Promise<{ event?: string; next?: string }>;
};

export default async function UnlockEventPage({ searchParams }: UnlockPageProps) {
  const params = await searchParams;
  const eventSlug = params?.event ?? "";
  const nextPath = params?.next ?? `/attendee?event=${eventSlug}`;
  return (
    <div className="mx-auto max-w-lg space-y-5 rounded-2xl border border-slate-200 bg-white p-6">
      <header>
        <p className="text-xs uppercase tracking-wide text-slate-500">Private gallery access</p>
        <h1 className="text-2xl font-semibold text-slate-900">Unlock Event</h1>
        <p className="mt-1 text-sm text-slate-600">Event: {eventSlug || "Unknown event"}</p>
      </header>
      <UnlockForm eventSlug={eventSlug} nextPath={nextPath} />
    </div>
  );
}
