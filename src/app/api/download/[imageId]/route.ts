import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { decodeSession, SESSION_COOKIE_NAME } from "@/lib/session";
import { createDeliveryUrlForAsset } from "@/lib/asset-delivery";
import { createSignedDownloadUrl } from "@/lib/signed-download";

type Params = {
  params: Promise<{ imageId: string }>;
};

export async function GET(request: NextRequest, { params }: Params) {
  const session = decodeSession(request.cookies.get(SESSION_COOKIE_NAME)?.value ?? null);
  if (!session) return NextResponse.json({ ok: false, message: "Login required." }, { status: 401 });

  const orderId = request.nextUrl.searchParams.get("order");
  if (!orderId) {
    return NextResponse.json({ ok: false, message: "Order id is required." }, { status: 400 });
  }

  const resolved = await params;
  const order = await db.order.findUnique({
    where: { id: orderId },
    include: {
      buyer: { select: { email: true } },
      orderItems: {
        where: { imageId: resolved.imageId },
        include: { image: { select: { previewUrl: true, fullResUrl: true, storageKey: true } } },
      },
    },
  });

  if (!order || order.orderItems.length === 0) {
    return NextResponse.json({ ok: false, message: "Licensed image not found for order." }, { status: 404 });
  }
  if (order.status !== "paid") {
    return NextResponse.json({ ok: false, message: "Order not paid." }, { status: 403 });
  }
  if (session.role !== "ADMIN" && order.buyer.email.toLowerCase() !== session.email.toLowerCase()) {
    return NextResponse.json({ ok: false, message: "Not authorized for download." }, { status: 403 });
  }

  let sourceUrl: string;
  try {
    sourceUrl = await createDeliveryUrlForAsset(order.orderItems[0].image);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unable to create delivery URL.";
    return NextResponse.json({ ok: false, message: errorMessage }, { status: 500 });
  }
  const appOrigin = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
  const provider = (process.env.ASSET_DELIVERY_PROVIDER || "direct").toLowerCase();
  const redirectUrl =
    provider === "s3"
      ? sourceUrl
      : createSignedDownloadUrl({
          origin: appOrigin,
          imageId: resolved.imageId,
          orderId,
          assetUrl: sourceUrl,
        });

  return NextResponse.redirect(redirectUrl);
}
