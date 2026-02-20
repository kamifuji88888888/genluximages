const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp"] as const;
const VIDEO_EXTENSIONS = ["mp4", "mov", "m4v", "webm"] as const;
const ALL_EXTENSIONS = [...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS] as const;

export const NAMING_CONVENTION_LABEL =
  "YYYY-MM-DD_event-slug_subject_photographerinitials_sequence.ext";

export type MediaKind = "image" | "video" | "unknown";

export function getMediaKindFromExtension(extension: string): MediaKind {
  const ext = extension.toLowerCase();
  if ((IMAGE_EXTENSIONS as readonly string[]).includes(ext)) return "image";
  if ((VIDEO_EXTENSIONS as readonly string[]).includes(ext)) return "video";
  return "unknown";
}

function slugifyPart(input: string, fallback: string) {
  const cleaned = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || fallback;
}

function initialsFromInput(input: string) {
  const letters = (input.match(/[a-z]/gi) || []).join("").toLowerCase();
  const initials = letters.slice(0, 3);
  return initials.length >= 2 ? initials : "ph";
}

function dateStamp(date = new Date()) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function suggestMediaFilename(inputFilename: string) {
  const filename = inputFilename.trim();
  const extMatch = filename.match(/\.([a-z0-9]+)$/i);
  const extension = (extMatch?.[1] || "jpg").toLowerCase();
  const safeExtension = (ALL_EXTENSIONS as readonly string[]).includes(extension)
    ? extension
    : "jpg";

  const base = filename.replace(/\.[a-z0-9]+$/i, "");
  const tokens = base
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter(Boolean);

  const eventSlug = slugifyPart(tokens.slice(0, 3).join("-"), "event");
  const subject = slugifyPart(tokens.slice(3, 6).join("-"), "moment");
  const initials = initialsFromInput(tokens.slice(-1)[0] || base);

  return `${dateStamp()}_${eventSlug}_${subject}_${initials}_0001.${safeExtension}`;
}

export function validateMediaFilename(filename: string) {
  const normalized = filename.trim();
  const match = normalized.match(
    /^(\d{4}-\d{2}-\d{2})_([a-z0-9-]+)_([a-z0-9-]+)_([a-z]{2,8})_(\d{3,5})\.([a-z0-9]+)$/i,
  );
  if (!match) {
    return {
      ok: false,
      mediaKind: "unknown" as MediaKind,
      message: `Filename must match ${NAMING_CONVENTION_LABEL}`,
      suggestion: suggestMediaFilename(normalized),
    };
  }

  const extension = match[6].toLowerCase();
  const mediaKind = getMediaKindFromExtension(extension);
  if (mediaKind === "unknown") {
    return {
      ok: false,
      mediaKind,
      message: `Unsupported extension ".${extension}". Allowed: ${ALL_EXTENSIONS.join(", ")}.`,
      suggestion: suggestMediaFilename(normalized),
    };
  }

  return {
    ok: true,
    mediaKind,
    extension,
  };
}

