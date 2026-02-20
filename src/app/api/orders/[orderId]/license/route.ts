import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { decodeSession, SESSION_COOKIE_NAME } from "@/lib/session";

type Params = {
  params: Promise<{ orderId: string }>;
};

export async function GET(request: NextRequest, { params }: Params) {
  const session = decodeSession(request.cookies.get(SESSION_COOKIE_NAME)?.value ?? null);
  if (!session) return new NextResponse("Login required.", { status: 401 });

  const resolved = await params;
  const order = await db.order.findUnique({
    where: { id: resolved.orderId },
    include: {
      buyer: { select: { email: true, name: true } },
      orderItems: { include: { image: { select: { title: true, filename: true } } } },
    },
  });
  if (!order) return new NextResponse("Order not found.", { status: 404 });
  if (session.role !== "ADMIN" && order.buyer.email.toLowerCase() !== session.email.toLowerCase()) {
    return new NextResponse("Not authorized.", { status: 403 });
  }

  const lines = [
    "GENLUXIMAGES LICENSE RECEIPT",
    `Order ID: ${order.id}`,
    `Receipt Token: ${order.receiptToken}`,
    `Status: ${order.status}`,
    `Buyer: ${order.buyer.name} <${order.buyer.email}>`,
    `Issued At: ${order.createdAt.toISOString()}`,
    `Payment Provider: ${order.paymentProvider}`,
    `Payment Reference: ${order.paymentReference ?? "n/a"}`,
    "",
    "Licensed Assets:",
    ...order.orderItems.map(
      (item, index) =>
        `${index + 1}. ${item.image.title} (${item.image.filename}) | ${item.licenseCode} | $${item.priceUsd}`,
    ),
    "",
    `Total: $${order.totalUsd} ${order.currency}`,
    "",
    "License Terms:",
    "- Editorial licenses are restricted to news/editorial contexts.",
    "- Commercial licenses require no defamatory/illegal usage.",
    "- Redistribution or resale of original files is prohibited.",
  ];

  return new NextResponse(lines.join("\n"), {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename=\"genlux-license-${order.id}.txt\"`,
    },
  });
}
