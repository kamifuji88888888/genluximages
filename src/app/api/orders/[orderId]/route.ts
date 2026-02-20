import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { decodeSession, SESSION_COOKIE_NAME } from "@/lib/session";

type Params = {
  params: Promise<{ orderId: string }>;
};

export async function GET(request: NextRequest, { params }: Params) {
  const session = decodeSession(request.cookies.get(SESSION_COOKIE_NAME)?.value ?? null);
  if (!session) {
    return NextResponse.json({ ok: false, message: "Login required." }, { status: 401 });
  }

  const resolved = await params;
  const order = await db.order.findUnique({
    where: { id: resolved.orderId },
    include: {
      buyer: { select: { email: true, name: true } },
      orderItems: {
        include: {
          image: {
            select: {
              id: true,
              title: true,
              eventName: true,
              filename: true,
              previewUrl: true,
              fullResUrl: true,
              storageKey: true,
            },
          },
        },
      },
    },
  });

  if (!order) return NextResponse.json({ ok: false, message: "Order not found." }, { status: 404 });
  if (session.role !== "ADMIN" && order.buyer.email.toLowerCase() !== session.email.toLowerCase()) {
    return NextResponse.json({ ok: false, message: "Not authorized for this order." }, { status: 403 });
  }

  return NextResponse.json({
    ok: true,
    order: {
      id: order.id,
      status: order.status,
      totalUsd: order.totalUsd,
      createdAt: order.createdAt,
      currency: order.currency,
      paymentProvider: order.paymentProvider,
      paymentReference: order.paymentReference,
      buyer: order.buyer,
      items: order.orderItems.map((item) => ({
        imageId: item.image.id,
        title: item.image.title,
        eventName: item.image.eventName,
        filename: item.image.filename,
        previewUrl: item.image.previewUrl,
        hasFullResUrl: !!item.image.fullResUrl,
        hasStorageKey: !!item.image.storageKey,
        licenseCode: item.licenseCode,
        priceUsd: item.priceUsd,
        downloadUrl: `/api/download/${item.image.id}?order=${order.id}`,
      })),
    },
  });
}
