/**
 * Photographer-verified name dictionary.
 * Grows when a photographer confirms/corrects a title (catalog submit or Name queue).
 * Used to spell-check OCR before auto-naming (e.g. Mary Hellmnud → Mary Hellmund).
 */
import { db } from "@/lib/db";
import { correctNameAgainstRoster, type RosterCorrection } from "@/lib/subject-name-consensus";

const MAX_VERIFIED_NAMES = 500;

function normalizeDisplayName(name: string) {
  return name
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function subjectKey(name: string) {
  return normalizeDisplayName(name).toLowerCase();
}

/** Skip junk titles that are not person names. */
export function looksLikePersonName(name: string): boolean {
  const parts = name
    .trim()
    .split(/\s+/)
    .map((p) => p.replace(/[^a-zA-Z'-]/g, ""))
    .filter((p) => p.length >= 2);
  if (parts.length < 2 || parts.length > 4) return false;
  if (parts.some((p) => p.length > 22)) return false;
  return true;
}

export async function getVerifiedNamesForPhotographer(
  photographerId: string,
): Promise<string[]> {
  const rows = await db.verifiedSubjectName.findMany({
    where: { photographerId },
    orderBy: [{ timesUsed: "desc" }, { updatedAt: "desc" }],
    take: MAX_VERIFIED_NAMES,
    select: { subjectDisplayName: true },
  });
  return rows.map((r) => r.subjectDisplayName);
}

export async function upsertVerifiedSubjectName(args: {
  photographerId: string;
  name: string;
  source?: "catalog" | "manual" | "slate_confirmed";
  eventSlug?: string;
}): Promise<boolean> {
  const display = normalizeDisplayName(args.name);
  if (!looksLikePersonName(display)) return false;
  const key = subjectKey(display);
  const source = args.source || "catalog";
  const lastEventSlug = args.eventSlug?.trim().toLowerCase() || null;

  await db.verifiedSubjectName.upsert({
    where: {
      photographerId_subjectKey: {
        photographerId: args.photographerId,
        subjectKey: key,
      },
    },
    create: {
      photographerId: args.photographerId,
      subjectKey: key,
      subjectDisplayName: display,
      source,
      lastEventSlug,
      timesUsed: 1,
    },
    update: {
      subjectDisplayName: display,
      source,
      lastEventSlug: lastEventSlug ?? undefined,
      timesUsed: { increment: 1 },
    },
  });
  return true;
}

/** Prefer verified dictionary; fall back to event roster. */
export function correctNameAgainstVerifiedAndRoster(args: {
  candidate: string;
  verifiedNames: string[];
  rosterNames: string[];
}): RosterCorrection & { source: "verified" | "roster" | "none" } {
  const verified = correctNameAgainstRoster(args.candidate, args.verifiedNames);
  if (verified.matched) {
    return { ...verified, source: "verified" };
  }
  const roster = correctNameAgainstRoster(args.candidate, args.rosterNames);
  if (roster.matched) {
    return { ...roster, source: "roster" };
  }
  return { ...roster, source: "none" };
}

export async function recordVerifiedNameUse(args: {
  photographerId: string;
  name: string;
}) {
  const key = subjectKey(args.name);
  if (!key) return;
  await db.verifiedSubjectName.updateMany({
    where: { photographerId: args.photographerId, subjectKey: key },
    data: { timesUsed: { increment: 1 } },
  });
}
