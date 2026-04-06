/**
 * Second pass: after a slate photo saves a new subject reference, try to visually match
 * older catalog rows still in needs_manual for the same event + photographer.
 */
import { db } from "@/lib/db";
import { getKnownSubjectsForEvent } from "@/lib/subject-memory";
import {
  getSubjectMatchMinConfidence,
  matchSubjectAgainstKnown,
} from "@/lib/upload-ai";

const MAX_IMAGES_PER_TRIGGER = 18;
const MAX_LIFETIME_RETRIES = 10;
const FETCH_TIMEOUT_MS = 12_000;

function absolutePreviewUrl(previewUrl: string): string {
  const trimmed = previewUrl.trim();
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  const base = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
  if (!base) return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  const path = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return `${base}${path}`;
}

async function fetchPreviewAsDataUrl(previewUrl: string): Promise<string | null> {
  try {
    const url = absolutePreviewUrl(previewUrl);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength < 32 || buf.byteLength > 12 * 1024 * 1024) return null;
    const mime = res.headers.get("content-type")?.split(";")[0]?.trim() || "image/jpeg";
    if (!mime.startsWith("image/")) return null;
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

function normalizeEventSlug(eventSlug: string) {
  return eventSlug.trim().toLowerCase() || "general";
}

export async function retryNeedsManualSubjectNaming(args: {
  photographerId: string;
  eventSlug: string;
}): Promise<{ attempted: number; updated: number }> {
  const slug = normalizeEventSlug(args.eventSlug);
  const known = await getKnownSubjectsForEvent({
    photographerId: args.photographerId,
    eventSlug: slug,
  });
  if (known.length === 0) return { attempted: 0, updated: 0 };

  const pending = await db.imageAsset.findMany({
    where: {
      photographerId: args.photographerId,
      eventSlug: { equals: slug, mode: "insensitive" },
      subjectNamingStatus: "needs_manual",
      status: { not: "archived" },
      subjectMatchRetryCount: { lt: MAX_LIFETIME_RETRIES },
    },
    orderBy: { createdAt: "asc" },
    take: MAX_IMAGES_PER_TRIGGER,
    select: {
      id: true,
      previewUrl: true,
      subjectMatchRetryCount: true,
    },
  });

  const minConf = getSubjectMatchMinConfidence();
  let updated = 0;

  for (const row of pending) {
    const dataUrl = await fetchPreviewAsDataUrl(row.previewUrl);
    await db.imageAsset.update({
      where: { id: row.id },
      data: { subjectMatchRetryCount: { increment: 1 } },
    });

    if (!dataUrl) continue;

    const match = await matchSubjectAgainstKnown({
      imageDataUrl: dataUrl,
      knownSubjects: known,
    });

    if (match.subjectName && match.confidence >= minConf) {
      await db.imageAsset.update({
        where: { id: row.id },
        data: {
          title: match.subjectName,
          subjectNamingStatus: "from_match",
          subjectNamingConfidence: match.confidence,
        },
      });
      updated += 1;
    }
  }

  return { attempted: pending.length, updated };
}

/** Fire-and-forget from upload pipeline so the HTTP response is not blocked. */
export function scheduleRetryNeedsManualSubjectNaming(args: {
  photographerId: string;
  eventSlug: string;
}) {
  void retryNeedsManualSubjectNaming(args).then(
    ({ attempted, updated }) => {
      if (updated > 0) {
        console.info(
          `[subject-retry] event=${args.eventSlug} attempted=${attempted} auto_named=${updated}`,
        );
      }
    },
    (err) => console.error("[subject-retry] failed:", err),
  );
}
