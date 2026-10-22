/**
 * Face gallery helpers: detect the largest face with Google Vision FACE_DETECTION,
 * crop it tightly (with padding), and prepare gallery entries for visual re-ID.
 * Used so slate-named people can be matched in later photos without a board.
 */
import sharp from "sharp";
import { isGoogleVisionConfigured } from "@/lib/google-vision-ocr";

const VISION_ANNOTATE_URL = "https://vision.googleapis.com/v1/images:annotate";
const MAX_REQUEST_BYTES = 3.2 * 1024 * 1024;

type VisionVertex = { x?: number; y?: number };

export type FaceCropResult = {
  dataUrl: string;
  /** Normalized face center / size in the source image (0–1). */
  cx: number;
  cy: number;
  w: number;
  h: number;
  detectionConfidence: number;
};

function dataUrlToBuffer(dataUrl: string): Buffer | null {
  const marker = "base64,";
  const i = dataUrl.indexOf(marker);
  if (i === -1) return null;
  const payload = dataUrl.slice(i + marker.length);
  if (!payload) return null;
  return Buffer.from(payload, "base64");
}

async function ensureVisionSized(buffer: Buffer): Promise<Buffer> {
  if (buffer.byteLength <= MAX_REQUEST_BYTES) return buffer;
  return sharp(buffer)
    .resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: false })
    .jpeg({ quality: 85 })
    .toBuffer();
}

function polyToBox(vertices: VisionVertex[] | undefined, pageW: number, pageH: number) {
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
    minX,
    minY,
    maxX,
    maxY,
    wPx,
    hPx,
    cx: (minX + maxX) / 2 / pageW,
    cy: (minY + maxY) / 2 / pageH,
    w: wPx / pageW,
    h: hPx / pageH,
    area: wPx * hPx,
  };
}

/**
 * Detect faces via Google Vision and return a padded crop of the largest face.
 * Returns undefined when Vision is not configured or no usable face is found.
 */
export async function extractLargestFaceCrop(
  image: Buffer | string,
): Promise<FaceCropResult | undefined> {
  if (!isGoogleVisionConfigured()) return undefined;
  const apiKey = process.env.GOOGLE_CLOUD_VISION_API_KEY?.trim();
  if (!apiKey) return undefined;

  try {
    const inputBytes = Buffer.isBuffer(image) ? image : dataUrlToBuffer(image);
    if (!inputBytes || inputBytes.length < 32) return undefined;

    const meta = await sharp(inputBytes).metadata();
    const srcW = meta.width ?? 0;
    const srcH = meta.height ?? 0;
    if (srcW < 32 || srcH < 32) return undefined;

    const sized = await ensureVisionSized(inputBytes);
    const sizedMeta = await sharp(sized).metadata();
    const detectW = sizedMeta.width ?? srcW;
    const detectH = sizedMeta.height ?? srcH;

    const response = await fetch(`${VISION_ANNOTATE_URL}?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: [
          {
            image: { content: sized.toString("base64") },
            features: [{ type: "FACE_DETECTION", maxResults: 8 }],
          },
        ],
      }),
    });
    if (!response.ok) return undefined;

    const data = (await response.json()) as {
      responses?: Array<{
        faceAnnotations?: Array<{
          detectionConfidence?: number;
          boundingPoly?: { vertices?: VisionVertex[] };
          fdBoundingPoly?: { vertices?: VisionVertex[] };
        }>;
        error?: { message?: string };
      }>;
    };
    const faces = data.responses?.[0]?.faceAnnotations || [];
    if (faces.length === 0) return undefined;

    let best:
      | {
          box: NonNullable<ReturnType<typeof polyToBox>>;
          detectionConfidence: number;
        }
      | null = null;

    for (const face of faces) {
      const poly = face.fdBoundingPoly?.vertices || face.boundingPoly?.vertices;
      const box = polyToBox(poly, detectW, detectH);
      if (!box) continue;
      // Ignore tiny detections (noise / distant background faces)
      if (box.w < 0.04 || box.h < 0.04) continue;
      const conf = face.detectionConfidence ?? 0.7;
      if (!best || box.area > best.box.area) {
        best = { box, detectionConfidence: conf };
      }
    }
    if (!best) return undefined;

    // Map detection coords (on resized image) back to source pixels
    const scaleX = srcW / detectW;
    const scaleY = srcH / detectH;
    const padX = best.box.wPx * 0.35;
    const padY = best.box.hPx * 0.45;
    let left = Math.floor((best.box.minX - padX) * scaleX);
    let top = Math.floor((best.box.minY - padY) * scaleY);
    let width = Math.ceil((best.box.wPx + padX * 2) * scaleX);
    let height = Math.ceil((best.box.hPx + padY * 2) * scaleY);
    left = Math.max(0, left);
    top = Math.max(0, top);
    width = Math.min(srcW - left, Math.max(32, width));
    height = Math.min(srcH - top, Math.max(32, height));
    if (width < 32 || height < 32) return undefined;

    const crop = await sharp(inputBytes)
      .extract({ left, top, width, height })
      .resize({
        width: 512,
        height: 512,
        fit: "inside",
        withoutEnlargement: false,
      })
      .jpeg({ quality: 88 })
      .toBuffer();

    return {
      dataUrl: `data:image/jpeg;base64,${crop.toString("base64")}`,
      cx: best.box.cx,
      cy: best.box.cy,
      w: best.box.w,
      h: best.box.h,
      detectionConfidence: best.detectionConfidence,
    };
  } catch (e) {
    console.warn("Face crop extraction failed:", e);
    return undefined;
  }
}

/**
 * Prefer a stored face crop for matching; fall back to the full reference frame.
 */
export function preferredMatchImage(args: {
  faceCropDataUrl?: string | null;
  referenceImageDataUrl: string;
}): string {
  const face = args.faceCropDataUrl?.trim();
  if (face && face.startsWith("data:image/")) return face;
  return args.referenceImageDataUrl;
}
