import { NextResponse } from "next/server";
import { isGoogleVisionConfigured } from "@/lib/google-vision-ocr";
import { runOcrOnImageBuffer } from "@/lib/slate-ocr";

const OCR_TIMEOUT_MS = 25_000;
export const maxDuration = 30;

const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

/**
 * POST /api/upload/ocr-region
 * Body: multipart/form-data with one file field "image" (cropped slate region).
 * Requires GOOGLE_CLOUD_VISION_API_KEY (no Tesseract fallback here to avoid server hangs).
 */
export async function POST(request: Request) {
  try {
    if (!isGoogleVisionConfigured()) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "OCR not configured. Set GOOGLE_CLOUD_VISION_API_KEY in Railway (or .env) and redeploy.",
        },
        { status: 503 }
      );
    }
    const formData = await request.formData();
    const file = formData.get("image");
    if (!file || typeof file === "string") {
      return NextResponse.json(
        { ok: false, message: "Missing or invalid image file" },
        { status: 400 }
      );
    }
    const blob = file as Blob;
    if (blob.size > MAX_SIZE_BYTES) {
      return NextResponse.json(
        { ok: false, message: "Image too large" },
        { status: 400 }
      );
    }
    const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
    const hasAllowedType = blob.type && allowedTypes.includes(blob.type);
    if (!hasAllowedType && blob.type !== "") {
      return NextResponse.json(
        { ok: false, message: "Unsupported image type" },
        { status: 400 }
      );
    }
    const arrayBuffer = await blob.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("OCR request timed out (25s). Check Railway logs.")), OCR_TIMEOUT_MS)
    );
    const { candidateName, rawText, provider } = await Promise.race([
      runOcrOnImageBuffer(buffer),
      timeoutPromise,
    ]);
    return NextResponse.json({
      ok: true,
      candidateName,
      rawText,
      ...(provider && { provider }),
    });
  } catch (e) {
    console.error("ocr-region error:", e);
    return NextResponse.json(
      { ok: false, message: e instanceof Error ? e.message : "OCR failed" },
      { status: 500 }
    );
  }
}
