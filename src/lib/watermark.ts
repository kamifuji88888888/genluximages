export const WATERMARK_BANNER_OPACITY = 0.34;
export const WATERMARK_NUMBER_OPACITY = 0.56;

export function formatPhotographerName(photographerName: string) {
  const safeName = photographerName.trim() || "UNKNOWN PHOTOGRAPHER";
  return safeName.toUpperCase();
}

export function extractImageNumber(input: string) {
  const sequenceMatch = input.match(/_(\d{3,5})\.[a-z0-9]+$/i);
  if (sequenceMatch?.[1]) return sequenceMatch[1];

  const idMatch = input.match(/[a-z0-9]{6,}$/i);
  if (idMatch?.[0]) return idMatch[0];

  return input.slice(0, 8);
}

export function xmlEscape(input: string) {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
