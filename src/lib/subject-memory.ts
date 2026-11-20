import { db } from "@/lib/db";
import {
  computeFaceEmbedding,
  parseFaceEmbedding,
} from "@/lib/face-embeddings";
import { indexSubjectFaceInCollection } from "@/lib/rekognition-gallery";

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

function dataUrlToBuffer(dataUrl: string): Buffer | null {
  const marker = "base64,";
  const i = dataUrl.indexOf(marker);
  if (i === -1) return null;
  const payload = dataUrl.slice(i + marker.length);
  if (!payload) return null;
  return Buffer.from(payload, "base64");
}

export type KnownSubjectForMatch = {
  name: string;
  referenceImageDataUrl: string;
  /** Tight face crop when available — preferred for visual re-ID. */
  faceCropDataUrl?: string;
  /** Precomputed FaceNet-style descriptor when available. */
  faceEmbedding?: number[];
  rekognitionFaceId?: string;
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
    faceCropDataUrl: r.faceCropDataUrl || undefined,
    faceEmbedding: parseFaceEmbedding(r.faceEmbedding),
    rekognitionFaceId: r.rekognitionFaceId || undefined,
  }));
}

export async function upsertKnownSubjectForEvent(args: {
  photographerId: string;
  eventSlug: string;
  name: string;
  referenceImageDataUrl: string;
  faceCropDataUrl?: string;
  faceEmbedding?: number[];
}) {
  const slug = normalizeEventSlug(args.eventSlug);
  const display = normalizeName(args.name);
  const key = subjectKey(args.name);
  let dataUrl = args.referenceImageDataUrl;
  if (dataUrl.length > MAX_REFERENCE_DATA_URL_LENGTH) {
    dataUrl = dataUrl.slice(0, MAX_REFERENCE_DATA_URL_LENGTH);
  }
  let faceUrl = args.faceCropDataUrl?.trim() || undefined;
  if (faceUrl && faceUrl.length > MAX_REFERENCE_DATA_URL_LENGTH) {
    faceUrl = faceUrl.slice(0, MAX_REFERENCE_DATA_URL_LENGTH);
  }

  let embedding = parseFaceEmbedding(args.faceEmbedding);
  if (!embedding && faceUrl) {
    embedding = await computeFaceEmbedding(faceUrl);
  }

  let rekognitionFaceId: string | undefined;
  if (faceUrl) {
    const faceBuf = dataUrlToBuffer(faceUrl);
    if (faceBuf) {
      rekognitionFaceId = await indexSubjectFaceInCollection({
        photographerId: args.photographerId,
        eventSlug: slug,
        subjectKey: key,
        faceImage: faceBuf,
      });
    }
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
      faceCropDataUrl: faceUrl,
      faceEmbedding: embedding ?? undefined,
      rekognitionFaceId,
    },
    update: {
      subjectDisplayName: display,
      referenceDataUrl: dataUrl,
      ...(faceUrl ? { faceCropDataUrl: faceUrl } : {}),
      ...(embedding ? { faceEmbedding: embedding } : {}),
      ...(rekognitionFaceId ? { rekognitionFaceId } : {}),
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
