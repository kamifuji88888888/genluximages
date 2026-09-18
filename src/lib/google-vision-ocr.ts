/**
 * Google Cloud Vision API OCR (text detection).
 * Uses DOCUMENT_TEXT_DETECTION + TEXT_DETECTION together with English hints for
 * slate / whiteboard-style text (mixed handwriting and print).
 * Also returns word-level bounding boxes for foreground vs backdrop scoring.
 */

import sharp from "sharp";

const VISION_ANNOTATE_URL = "https://vision.googleapis.com/v1/images:annotate";

const MAX_REQUEST_BYTES = 3.2 * 1024 * 1024;

export type VisionWordBox = {
  text: string;
  confidence: number;
  /** Center X in 0–1 page coords. */
  cx: number;
  /** Center Y in 0–1 page coords. */
  cy: number;
  /** Width / height in 0–1 page coords. */
  w: number;
  h: number;
};

type VisionVertex = { x?: number; y?: number };
type VisionWord = {
  confidence?: number;
  boundingBox?: { vertices?: VisionVertex[] };
  symbols?: Array<{ text?: string; confidence?: number }>;
};
type VisionPage = {
  width?: number;
  height?: number;
  blocks?: Array<{
    paragraphs?: Array<{
      words?: VisionWord[];
    }>;
  }>;
};

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

function wordTextFromSymbols(word: VisionWord): string {
  return (word.symbols || [])
    .map((s) => s.text || "")
    .join("")
    .trim();
}

function verticesToBox(
  vertices: VisionVertex[] | undefined,
  pageW: number,
  pageH: number,
): { cx: number; cy: number; w: number; h: number } | null {
  if (!vertices || vertices.length < 2 || pageW < 1 || pageH < 1) return null;
  const xs = vertices.map((v) => v.x ?? 0);
  const ys = vertices.map((v) => v.y ?? 0);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const wPx = Math.max(1, maxX - minX);
  const hPx = Math.max(1, maxY - minY);
  return {
    cx: (minX + maxX) / 2 / pageW,
    cy: (minY + maxY) / 2 / pageH,
    w: wPx / pageW,
    h: hPx / pageH,
  };
}

/** Extract word boxes from DOCUMENT_TEXT_DETECTION fullTextAnnotation. */
export function extractVisionWordBoxes(
  fullTextAnnotation: { pages?: VisionPage[]; text?: string } | undefined,
): VisionWordBox[] {
  const pages = fullTextAnnotation?.pages || [];
  const out: VisionWordBox[] = [];
  for (const page of pages) {
    const pageW = page.width || 0;
    const pageH = page.height || 0;
    if (pageW < 1 || pageH < 1) continue;
    for (const block of page.blocks || []) {
      for (const para of block.paragraphs || []) {
        for (const word of para.words || []) {
          const text = wordTextFromSymbols(word);
          if (!text) continue;
          const box = verticesToBox(word.boundingBox?.vertices, pageW, pageH);
          if (!box) continue;
          const conf =
            typeof word.confidence === "number"
              ? word.confidence
              : averageSymbolConfidence(word);
          out.push({
            text,
            confidence: Math.max(0, Math.min(1, conf)),
            ...box,
          });
        }
      }
    }
  }
  return out;
}

function averageSymbolConfidence(word: VisionWord): number {
  const confs = (word.symbols || [])
    .map((s) => s.confidence)
    .filter((c): c is number => typeof c === "number");
  if (confs.length === 0) return 0.75;
  return confs.reduce((a, b) => a + b, 0) / confs.length;
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

export async function runGoogleVisionOcr(
  imageBuffer: Buffer,
): Promise<{ rawText: string; words: VisionWordBox[] }> {
  const apiKey = process.env.GOOGLE_CLOUD_VISION_API_KEY?.trim();
  if (!apiKey) {
    return { rawText: "", words: [] };
  }

  const sized = await ensureVisionFriendlyImageBuffer(imageBuffer);
  const base64 = sized.toString("base64");
  const imageContext = {
    languageHints: ["en"],
  };

  // Two requests: DOCUMENT_TEXT_DETECTION alone can suppress TEXT_DETECTION in a single
  // request; batching both recovers dense slate text plus scene-style blocks.
  const requests: Array<Record<string, unknown>> = [
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
  ];

  // Optional extra layer: handwriting-tuned OCR for marker/dry-erase slates.
  // `en-t-i0-handwrit` biases the model toward Latin handwriting; kept additive so
  // typeset backdrop reads still come through the standard passes above.
  if (isHandwritingHintEnabled()) {
    requests.push({
      image: { content: base64 },
      imageContext: { languageHints: ["en-t-i0-handwrit"] },
      features: [{ type: "DOCUMENT_TEXT_DETECTION", maxResults: 1 }],
    });
  }

  const body = JSON.stringify({ requests });

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
      fullTextAnnotation?: { text?: string; pages?: VisionPage[] };
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
  const wordsByKey = new Map<string, VisionWordBox>();
  for (const r of responses) {
    const doc = r.fullTextAnnotation?.text?.trim() || "";
    const scene = r.textAnnotations?.[0]?.description?.trim() || "";
    if (doc) docLayer = mergeVisionTextLayers(docLayer, doc);
    if (scene) sceneLayer = mergeVisionTextLayers(sceneLayer, scene);
    for (const word of extractVisionWordBoxes(r.fullTextAnnotation)) {
      const key = `${word.text.toLowerCase()}@${word.cx.toFixed(3)},${word.cy.toFixed(3)}`;
      const existing = wordsByKey.get(key);
      if (!existing || word.confidence > existing.confidence) {
        wordsByKey.set(key, word);
      }
    }
  }
  const rawText = mergeVisionTextLayers(docLayer, sceneLayer);
  return { rawText, words: Array.from(wordsByKey.values()) };
}

export function isGoogleVisionConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLOUD_VISION_API_KEY?.trim());
}

/** Handwriting-hinted Vision pass is on by default; set GOOGLE_VISION_HANDWRITING_HINT=0/false to disable. */
export function isHandwritingHintEnabled(): boolean {
  const raw = (process.env.GOOGLE_VISION_HANDWRITING_HINT ?? "").trim().toLowerCase();
  if (raw === "") return true;
  return !(raw === "0" || raw === "false" || raw === "no" || raw === "off");
}
