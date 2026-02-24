/**
 * Shared slate/board OCR helpers: extract a candidate name from raw OCR text
 * and run Tesseract on an image buffer (used by upload file route and ocr-region API).
 */

export function pickNameFromOcrText(raw: string): string {
  const cleaned = raw
    .replace(/[|\\/_~`]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "";

  const lines = raw
    .split("\n")
    .map((line) => line.replace(/[^a-zA-Z\s'-]/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const candidates = [...lines, cleaned];
  const stop = new Set(["name", "subject", "guest", "talent", "board", "slate"]);
  for (const candidate of candidates) {
    const parts = candidate
      .split(" ")
      .map((part) => part.trim())
      .filter((part) => /^[a-zA-Z][a-zA-Z'-]{1,}$/.test(part))
      .filter((part) => !stop.has(part.toLowerCase()))
      .slice(0, 3);
    if (parts.length < 2) continue;
    return parts
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join(" ");
  }
  return "";
}

export async function runOcrOnImageBuffer(
  imageBuffer: Buffer
): Promise<{ candidateName: string; rawText: string }> {
  try {
    const { recognize } = await import("tesseract.js");
    const result = await recognize(imageBuffer, "eng");
    const text = result.data?.text?.trim() || "";
    const candidateName = pickNameFromOcrText(text);
    return { candidateName, rawText: text };
  } catch {
    return { candidateName: "", rawText: "" };
  }
}
