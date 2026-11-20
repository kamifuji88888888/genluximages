/**
 * Google Document AI Enterprise OCR fallback for hard slate / whiteboard crops.
 * Requires a service account JSON + Enterprise OCR processor resource name.
 *
 * Env:
 *   GOOGLE_DOCUMENT_AI_PROCESSOR = projects/.../locations/.../processors/...
 *   GOOGLE_SERVICE_ACCOUNT_JSON  = full service-account JSON string
 * Optional:
 *   GOOGLE_DOCUMENT_AI_LOCATION  = us | eu | ... (default parsed from processor, else us)
 */
import { GoogleAuth } from "google-auth-library";
import sharp from "sharp";

const MAX_REQUEST_BYTES = 3.2 * 1024 * 1024;

export function isDocumentAiConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_DOCUMENT_AI_PROCESSOR?.trim() &&
      process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim(),
  );
}

function parseProcessorLocation(processorName: string): string {
  const fromEnv = process.env.GOOGLE_DOCUMENT_AI_LOCATION?.trim();
  if (fromEnv) return fromEnv;
  const m = processorName.match(/\/locations\/([^/]+)\//);
  return m?.[1] || "us";
}

async function ensureSized(buffer: Buffer): Promise<Buffer> {
  if (buffer.byteLength <= MAX_REQUEST_BYTES) return buffer;
  return sharp(buffer)
    .resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: false })
    .jpeg({ quality: 85 })
    .toBuffer();
}

let authClient: GoogleAuth | null = null;

function getAuth(): GoogleAuth | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) return null;
  if (authClient) return authClient;
  try {
    const credentials = JSON.parse(raw) as Record<string, unknown>;
    authClient = new GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    });
    return authClient;
  } catch (e) {
    console.warn("Invalid GOOGLE_SERVICE_ACCOUNT_JSON:", e);
    return null;
  }
}

/**
 * Run Document AI OCR and return plain text (+ optional confidence from pages).
 */
export async function runDocumentAiOcr(
  imageBuffer: Buffer,
): Promise<{ rawText: string; confidence: number } | undefined> {
  if (!isDocumentAiConfigured()) return undefined;
  const processor = process.env.GOOGLE_DOCUMENT_AI_PROCESSOR?.trim();
  if (!processor) return undefined;
  const auth = getAuth();
  if (!auth) return undefined;

  try {
    const sized = await ensureSized(imageBuffer);
    const location = parseProcessorLocation(processor);
    const endpoint =
      location === "eu"
        ? "https://eu-documentai.googleapis.com"
        : `https://${location}-documentai.googleapis.com`;

    const client = await auth.getClient();
    const token = await client.getAccessToken();
    const accessToken = typeof token === "string" ? token : token?.token;
    if (!accessToken) return undefined;

    const response = await fetch(
      `${endpoint}/v1/${processor}:process`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          skipHumanReview: true,
          rawDocument: {
            content: sized.toString("base64"),
            mimeType: "image/jpeg",
          },
          // Prefer text extraction; keep payload smaller
          fieldMask: "text,pages.confidence",
        }),
      },
    );

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      console.warn(
        `Document AI OCR failed (${response.status}):`,
        errText.slice(0, 240),
      );
      return undefined;
    }

    const data = (await response.json()) as {
      document?: {
        text?: string;
        pages?: Array<{ confidence?: number }>;
      };
    };
    const rawText = (data.document?.text || "").trim();
    if (!rawText) return undefined;

    const pageConfs = (data.document?.pages || [])
      .map((p) => p.confidence)
      .filter((c): c is number => typeof c === "number" && Number.isFinite(c));
    const confidence =
      pageConfs.length > 0
        ? pageConfs.reduce((a, b) => a + b, 0) / pageConfs.length
        : 0.75;

    return { rawText, confidence };
  } catch (e) {
    console.warn("Document AI OCR error:", e);
    return undefined;
  }
}
