import { db } from "@/lib/db";

const MAX_SUBJECTS_PER_EVENT = 12;
/** Keep under typical API / DB limits; reference is already a downscaled preview. */
const MAX_REFERENCE_DATA_URL_LENGTH = 1_800_000;

function normalizeName(name: string) {
  return name
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function normalizeEventSlug(eventSlug: string) {
  return eventSlug.trim().toLowerCase() || "general";
}

function subjectKey(name: string) {
  return normalizeName(name).toLowerCase();
}

export type KnownSubjectForMatch = {
  name: string;
  referenceImageDataUrl: string;
};

export async function getKnownSubjectsForEvent(args: {
  photographerId: string;
  eventSlug: string;
}): Promise<KnownSubjectForMatch[]> {
  const slug = normalizeEventSlug(args.eventSlug);
  const rows = await db.eventSubjectReference.findMany({
    where: { photographerId: args.photographerId, eventSlug: slug },
    orderBy: { updatedAt: "desc" },
    take: MAX_SUBJECTS_PER_EVENT,
  });
  return rows.map((r) => ({
    name: r.subjectDisplayName,
    referenceImageDataUrl: r.referenceDataUrl,
  }));
}

export async function upsertKnownSubjectForEvent(args: {
  photographerId: string;
  eventSlug: string;
  name: string;
  referenceImageDataUrl: string;
}) {
  const slug = normalizeEventSlug(args.eventSlug);
  const display = normalizeName(args.name);
  const key = subjectKey(args.name);
  let dataUrl = args.referenceImageDataUrl;
  if (dataUrl.length > MAX_REFERENCE_DATA_URL_LENGTH) {
    dataUrl = dataUrl.slice(0, MAX_REFERENCE_DATA_URL_LENGTH);
  }

  await db.eventSubjectReference.upsert({
    where: {
      photographerId_eventSlug_subjectKey: {
        photographerId: args.photographerId,
        eventSlug: slug,
        subjectKey: key,
      },
    },
    create: {
      photographerId: args.photographerId,
      eventSlug: slug,
      subjectKey: key,
      subjectDisplayName: display,
      referenceDataUrl: dataUrl,
    },
    update: {
      subjectDisplayName: display,
      referenceDataUrl: dataUrl,
    },
  });

  const ordered = await db.eventSubjectReference.findMany({
    where: { photographerId: args.photographerId, eventSlug: slug },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  });
  const staleIds = ordered.slice(MAX_SUBJECTS_PER_EVENT).map((r) => r.id);
  if (staleIds.length > 0) {
    await db.eventSubjectReference.deleteMany({ where: { id: { in: staleIds } } });
  }
}
