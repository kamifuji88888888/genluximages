import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyStripeWebhook } from "@/lib/payment";

export async function POST(request: NextRequest) {
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ ok: false, message: "Missing stripe signature." }, { status: 400 });
  }

  const payload = await request.text();
  let event: ReturnType<typeof verifyStripeWebhook>;
  try {
    event = verifyStripeWebhook({ payload, signature });
  } catch {
    return NextResponse.json({ ok: false, message: "Invalid webhook signature." }, { status: 400 });
  }

  if (!event) {
    return NextResponse.json({ ok: false, message: "Stripe webhook is not configured." }, { status: 500 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const orderId = session.metadata?.orderId;
    if (orderId) {
      await db.order.update({
        where: { id: orderId },
        data: {
          status: "paid",
          paymentProvider: "stripe",
          paymentReference: session.id,
        },
      });
    }
  }

  if (event.type === "checkout.session.expired" || event.type === "checkout.session.async_payment_failed") {
    const session = event.data.object;
    const orderId = session.metadata?.orderId;
    if (orderId) {
      await db.order.update({
        where: { id: orderId },
        data: {
          status: "failed",
          paymentProvider: "stripe",
          paymentReference: session.id,
        },
      });
    }
  }

  return NextResponse.json({ received: true });
}
