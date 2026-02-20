import Stripe from "stripe";

export type CheckoutLineItem = {
  name: string;
  unitAmountUsd: number;
  quantity: number;
};

type StartCheckoutRequest = {
  orderId: string;
  amountUsd: number;
  buyerEmail: string;
  lineItems: CheckoutLineItem[];
  appOrigin: string;
};

type StartCheckoutResult = {
  ok: boolean;
  provider: "mock" | "stripe";
  reference: string;
  status: "paid" | "requires_redirect" | "failed";
  redirectUrl?: string;
  message?: string;
};

function getStripeClient() {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) return null;
  return new Stripe(secretKey);
}

export async function startCheckout(
  request: StartCheckoutRequest,
): Promise<StartCheckoutResult> {
  const provider = (process.env.PAYMENT_PROVIDER || "mock").toLowerCase();

  if (provider === "stripe") {
    const stripe = getStripeClient();
    if (!stripe) {
      return {
        ok: false,
        provider: "stripe",
        status: "failed",
        reference: "",
        message: "Stripe provider selected but STRIPE_SECRET_KEY is missing.",
      };
    }

    const successUrl = `${request.appOrigin}/checkout/success?order=${request.orderId}`;
    const cancelUrl = `${request.appOrigin}/checkout/cancel?order=${request.orderId}`;
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: request.buyerEmail,
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        orderId: request.orderId,
      },
      line_items: request.lineItems.map((item) => ({
        quantity: item.quantity,
        price_data: {
          currency: "usd",
          unit_amount: item.unitAmountUsd * 100,
          product_data: {
            name: item.name,
          },
        },
      })),
    });

    return {
      ok: true,
      provider: "stripe",
      status: "requires_redirect",
      reference: session.id,
      redirectUrl: session.url ?? undefined,
    };
  }

  return {
    ok: true,
    provider: "mock",
    status: "paid",
    reference: `mock_${request.orderId}_${request.amountUsd}_${request.buyerEmail}`,
  };
}

export function verifyStripeWebhook({
  payload,
  signature,
}: {
  payload: string;
  signature: string;
}) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const stripe = getStripeClient();
  if (!webhookSecret || !stripe) return null;

  return stripe.webhooks.constructEvent(payload, signature, webhookSecret);
}
