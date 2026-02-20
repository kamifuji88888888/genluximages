"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { clearCart } from "@/lib/cart";

type Props = {
  orderId: string;
};

export function CheckoutSuccessClient({ orderId }: Props) {
  const [status, setStatus] = useState("pending");

  useEffect(() => {
    let attempts = 0;
    const timer = setInterval(async () => {
      attempts += 1;
      const response = await fetch(`/api/orders/${orderId}`);
      if (!response.ok) {
        if (attempts > 10) clearInterval(timer);
        return;
      }
      const data = (await response.json()) as { order: { status: string } };
      setStatus(data.order.status);
      if (data.order.status === "paid") {
        clearCart();
        clearInterval(timer);
      } else if (attempts > 10) {
        clearInterval(timer);
      }
    }, 1500);

    return () => clearInterval(timer);
  }, [orderId]);

  return (
    <div className="space-y-2">
      <p className="text-sm text-slate-600">
        Payment status: <span className="font-semibold text-slate-900">{status}</span>
      </p>
      <div className="flex gap-3 text-sm">
        <Link href={`/orders/${orderId}`} className="font-medium text-blue-700 hover:underline">
          Open order receipt
        </Link>
        <Link href="/" className="font-medium text-blue-700 hover:underline">
          Return to marketplace
        </Link>
      </div>
    </div>
  );
}
