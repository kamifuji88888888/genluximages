import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { startCheckout } from "@/lib/payment";
import { decodeSession, SESSION_COOKIE_NAME } from "@/lib/session";

type CheckoutItem = {
  imageId: string;
};

type CheckoutRequest = {
  buyerEmail?: string;
  buyerName?: string;
  items?: CheckoutItem[];
};

export async function POST(request: NextRequest) {
  const session = decodeSession(request.cookies.get(SESSION_COOKIE_NAME)?.value ?? null);
  if (!session || (session.role !== "BUYER" && session.role !== "ADMIN")) {
    return NextResponse.json(
      { ok: false, message: "Buyer or admin login required for checkout." },
      { status: 403 },
    );
  }

  const body = (await request.json()) as CheckoutRequest;
  const items = body.items ?? [];

  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json(
      { ok: false, message: "Cart is empty." },
      { status: 400 },
    );
  }

  const buyerEmail = body.buyerEmail?.trim().toLowerCase() || session.email.toLowerCase();
  const buyerName = body.buyerName?.trim() || session.name;
  const imageIds = [...new Set(items.map((item) => item.imageId))];

  try {
    const buyer = await db.user.upsert({
      where: { email: buyerEmail },
      update: { name: buyerName, role: "BUYER" },
      create: { email: buyerEmail, name: buyerName, role: "BUYER" },
    });

    const purchasableImages = await db.imageAsset.findMany({
      where: {
        id: { in: imageIds },
        status: "published",
      },
      select: {
        id: true,
        title: true,
        priceUsd: true,
        usageRights: true,
      },
    });

    if (purchasableImages.length !== imageIds.length) {
      return NextResponse.json(
        { ok: false, message: "One or more selected images are not available for purchase." },
        { status: 400 },
      );
    }

    const totalUsd = purchasableImages.reduce((sum, image) => sum + image.priceUsd, 0);

    const order = await db.order.create({
      data: {
        buyerId: buyer.id,
        totalUsd,
        status: "pending",
        orderItems: {
          create: purchasableImages.map((image) => ({
            imageId: image.id,
            priceUsd: image.priceUsd,
            licenseCode:
              image.usageRights === "commercial"
                ? "standard-commercial"
                : "standard-editorial",
          })),
        },
      },
      include: {
        orderItems: { include: { image: { select: { title: true } } } },
      },
    });

    const appOrigin = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
    const checkout = await startCheckout({
      orderId: order.id,
      amountUsd: totalUsd,
      buyerEmail,
      appOrigin,
      lineItems: purchasableImages.map((image) => ({
        name: image.title,
        unitAmountUsd: image.priceUsd,
        quantity: 1,
      })),
    });

    if (!checkout.ok) {
      await db.order.update({
        where: { id: order.id },
        data: {
          status: "failed",
          paymentProvider: checkout.provider,
          paymentReference: checkout.reference || null,
        },
      });
      return NextResponse.json(
        { ok: false, message: checkout.message || "Payment initialization failed." },
        { status: 400 },
      );
    }

    if (checkout.status === "paid") {
      await db.order.update({
        where: { id: order.id },
        data: {
          status: "paid",
          paymentProvider: checkout.provider,
          paymentReference: checkout.reference,
        },
      });
    } else {
      await db.order.update({
        where: { id: order.id },
        data: {
          paymentProvider: checkout.provider,
          paymentReference: checkout.reference,
        },
      });
    }

    return NextResponse.json({
      ok: true,
      message:
        checkout.status === "requires_redirect"
          ? "Redirecting to secure payment checkout."
          : "Checkout complete. License order created.",
      orderId: order.id,
      receiptToken: order.receiptToken,
      totalUsd: order.totalUsd,
      itemCount: order.orderItems.length,
      checkoutStatus: checkout.status,
      checkoutUrl: checkout.redirectUrl,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Checkout failed.";
    return NextResponse.json(
      { ok: false, message: `Checkout could not be completed: ${errorMessage}` },
      { status: 500 },
    );
  }
}
