import { NextResponse } from "next/server";
import { runOcrOnImageBuffer } from "@/lib/slate-ocr";

const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

/**
 * POST /api/upload/ocr-region
 * Body: multipart/form-data with one file field "image" (cropped slate region).
 * Returns { ok, candidateName?, rawText?, message? }.
 */
export async function POST(request: Request) {
  try {
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
    if (!ALLOWED_TYPES.includes(blob.type)) {
      return NextResponse.json(
        { ok: false, message: "Unsupported image type" },
        { status: 400 }
      );
    }
    const arrayBuffer = await blob.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const { candidateName, rawText } = await runOcrOnImageBuffer(buffer);
    return NextResponse.json({
      ok: true,
      candidateName,
      rawText,
    });
  } catch (e) {
    console.error("ocr-region error:", e);
    return NextResponse.json(
      { ok: false, message: e instanceof Error ? e.message : "OCR failed" },
      { status: 500 }
    );
  }
}
