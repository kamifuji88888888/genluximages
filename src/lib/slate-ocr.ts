/**
 * Shared slate/board OCR helpers: extract a candidate name from raw OCR text
 * and run OCR on an image buffer (Google Cloud Vision only; no Tesseract on server).
 */
import {
  isGoogleVisionConfigured,
  runGoogleVisionOcr,
} from "@/lib/google-vision-ocr";

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
): Promise<{ candidateName: string; rawText: string; provider?: "google" | "tesseract" }> {
  if (!isGoogleVisionConfigured()) {
    return { candidateName: "", rawText: "" };
  }
  try {
    const { rawText } = await runGoogleVisionOcr(imageBuffer);
    const candidateName = pickNameFromOcrText(rawText);
    return { candidateName, rawText, provider: "google" };
  } catch (e) {
    console.error("Google Vision OCR failed:", e);
    return { candidateName: "", rawText: "" };
  }
}
