export type ParsedFilename = {
  filename: string;
  capturedAt?: string;
  eventSlug?: string;
  suggestedEventName?: string;
  suggestedTitle?: string;
};

function toTitleCase(input: string) {
  return input
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function parseCatalogFilename(filename: string): ParsedFilename {
  const regex =
    /^(\d{4}-\d{2}-\d{2})_([a-z0-9-]+)_([a-z0-9-]+)_([a-z0-9]+)_(\d{3,5})\.(jpg|jpeg|png|webp|mp4|mov|m4v|webm)$/i;

  const match = filename.match(regex);
  if (!match) return { filename };

  const [, capturedDate, eventSlug, subject] = match;
  return {
    filename,
    capturedAt: `${capturedDate}T12:00`,
    eventSlug,
    suggestedEventName: toTitleCase(eventSlug),
    suggestedTitle: toTitleCase(subject),
  };
}
