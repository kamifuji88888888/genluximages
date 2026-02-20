import { NextRequest, NextResponse } from "next/server";
import { verifySignedDownloadUrl } from "@/lib/signed-download";

export async function GET(request: NextRequest) {
  const imageId = request.nextUrl.searchParams.get("image");
  const orderId = request.nextUrl.searchParams.get("order");
  const assetUrl = request.nextUrl.searchParams.get("asset");
  const exp = request.nextUrl.searchParams.get("exp");
  const sig = request.nextUrl.searchParams.get("sig");

  if (!imageId || !orderId || !assetUrl || !exp || !sig) {
    return NextResponse.json({ ok: false, message: "Missing signed URL parameters." }, { status: 400 });
  }

  const valid = verifySignedDownloadUrl({
    imageId,
    orderId,
    assetUrl,
    exp,
    sig,
  });
  if (!valid) {
    return NextResponse.json({ ok: false, message: "Invalid or expired signed URL." }, { status: 403 });
  }

  const destination = assetUrl.includes("?") ? `${assetUrl}&dl=1` : `${assetUrl}?dl=1`;
  return NextResponse.redirect(destination);
}
