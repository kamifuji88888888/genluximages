/**
 * Google Cloud Vision API OCR (text detection).
 * Fast, typically sub-second. Use when GOOGLE_CLOUD_VISION_API_KEY is set.
 */

const VISION_ANNOTATE_URL = "https://vision.googleapis.com/v1/images:annotate";

export async function runGoogleVisionOcr(imageBuffer: Buffer): Promise<{ rawText: string }> {
  const apiKey = process.env.GOOGLE_CLOUD_VISION_API_KEY?.trim();
  if (!apiKey) {
    return { rawText: "" };
  }

  const base64 = imageBuffer.toString("base64");
  const body = JSON.stringify({
    requests: [
      {
        image: { content: base64 },
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

  const first = data.responses?.[0];
  if (!first) return { rawText: "" };
  if (first.error) {
    throw new Error(first.error.message || "Vision API error");
  }

  const rawText =
    first.fullTextAnnotation?.text?.trim() ||
    first.textAnnotations?.[0]?.description?.trim() ||
    "";
  return { rawText };
}

export function isGoogleVisionConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLOUD_VISION_API_KEY?.trim());
}
