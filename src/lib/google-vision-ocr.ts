/**
 * Google Cloud Vision API OCR (text detection).
 * Uses DOCUMENT_TEXT_DETECTION + TEXT_DETECTION together with English hints for
 * slate / whiteboard-style text (mixed handwriting and print).
 */

import sharp from "sharp";

const VISION_ANNOTATE_URL = "https://vision.googleapis.com/v1/images:annotate";

const MAX_REQUEST_BYTES = 3.2 * 1024 * 1024;

function mergeVisionTextLayers(docText: string, sceneText: string): string {
  const a = docText.trim();
  const b = sceneText.trim();
  if (!a) return b;
  if (!b) return a;
  if (a === b) return a;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  if (longer.includes(shorter)) return longer;
  return `${a}\n${b}`;
}

/**
 * Keeps Vision payloads under typical limits and improves OCR on tiny manual crops.
 */
export async function ensureVisionFriendlyImageBuffer(buffer: Buffer): Promise<Buffer> {
  if (buffer.byteLength <= MAX_REQUEST_BYTES) return buffer;
  return sharp(buffer)
    .resize({
      width: 2000,
      height: 2000,
      fit: "inside",
      withoutEnlargement: false,
    })
    .png()
    .toBuffer();
}

export async function runGoogleVisionOcr(imageBuffer: Buffer): Promise<{ rawText: string }> {
  const apiKey = process.env.GOOGLE_CLOUD_VISION_API_KEY?.trim();
  if (!apiKey) {
    return { rawText: "" };
  }

  const sized = await ensureVisionFriendlyImageBuffer(imageBuffer);
  const base64 = sized.toString("base64");
  const imageContext = {
    languageHints: ["en"],
  };

  // Two requests: DOCUMENT_TEXT_DETECTION alone can suppress TEXT_DETECTION in a single
  // request; batching both recovers dense slate text plus scene-style blocks.
  const body = JSON.stringify({
    requests: [
      {
        image: { content: base64 },
        imageContext,
        features: [{ type: "DOCUMENT_TEXT_DETECTION", maxResults: 1 }],
      },
      {
        image: { content: base64 },
        imageContext,
        features: [{ type: "TEXT_DETECTION", maxResults: 1 }],
      },
    ],
  });

  const url = `${VISION_ANNOTATE_URL}?key=${encodeURIComponent(apiKey)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Vision API ${response.status}: ${errText.slice(0, 200)}`);
  }

  const data = (await response.json()) as {
    responses?: Array<{
      fullTextAnnotation?: { text?: string };
      textAnnotations?: Array<{ description?: string }>;
      error?: { message?: string };
    }>;
  };

  const responses = data.responses ?? [];
  for (const r of responses) {
    if (r?.error?.message) {
      throw new Error(r.error.message);
    }
  }

  let docLayer = "";
  let sceneLayer = "";
  for (const r of responses) {
    const doc = r.fullTextAnnotation?.text?.trim() || "";
    const scene = r.textAnnotations?.[0]?.description?.trim() || "";
    if (doc) docLayer = mergeVisionTextLayers(docLayer, doc);
    if (scene) sceneLayer = mergeVisionTextLayers(sceneLayer, scene);
  }
  const rawText = mergeVisionTextLayers(docLayer, sceneLayer);
  return { rawText };
}

export function isGoogleVisionConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLOUD_VISION_API_KEY?.trim());
}
