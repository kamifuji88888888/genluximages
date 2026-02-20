type KnownSubject = {
  name: string;
  referenceImageDataUrl: string;
  updatedAt: number;
};

type SubjectStore = Map<string, KnownSubject[]>;

const SUBJECT_TTL_MS = 4 * 60 * 60 * 1000;
const MAX_SUBJECTS_PER_EVENT = 6;
const store: SubjectStore = new Map();

function keyFor(uploaderEmail: string, eventSlug: string) {
  return `${uploaderEmail.toLowerCase()}::${eventSlug.toLowerCase()}`;
}

function normalizeName(name: string) {
  return name
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function purgeExpired(list: KnownSubject[]) {
  const now = Date.now();
  return list.filter((entry) => now - entry.updatedAt <= SUBJECT_TTL_MS);
}

export function getKnownSubjectsForEvent(args: { uploaderEmail: string; eventSlug: string }) {
  const key = keyFor(args.uploaderEmail, args.eventSlug);
  const current = store.get(key) || [];
  const active = purgeExpired(current);
  if (active.length !== current.length) store.set(key, active);
  return active.map((entry) => ({
    name: entry.name,
    referenceImageDataUrl: entry.referenceImageDataUrl,
  }));
}

export function upsertKnownSubjectForEvent(args: {
  uploaderEmail: string;
  eventSlug: string;
  name: string;
  referenceImageDataUrl: string;
}) {
  const key = keyFor(args.uploaderEmail, args.eventSlug);
  const normalized = normalizeName(args.name);
  const now = Date.now();
  const current = purgeExpired(store.get(key) || []);
  const withoutSame = current.filter((entry) => entry.name.toLowerCase() !== normalized.toLowerCase());
  const next: KnownSubject[] = [
    { name: normalized, referenceImageDataUrl: args.referenceImageDataUrl, updatedAt: now },
    ...withoutSame,
  ].slice(0, MAX_SUBJECTS_PER_EVENT);
  store.set(key, next);
}
