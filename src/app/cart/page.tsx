"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { clearCart, getCart } from "@/lib/cart";
import { CartItem } from "@/lib/types";

export default function CartPage() {
  const [items, setItems] = useState<CartItem[]>(() => getCart());
  const [checkoutComplete, setCheckoutComplete] = useState(false);
  const [buyerName, setBuyerName] = useState("Guest Buyer");
  const [buyerEmail, setBuyerEmail] = useState("guest@genluximages.com");
  const [checkoutMessage, setCheckoutMessage] = useState<string>("");
  const [lastOrderId, setLastOrderId] = useState<string>("");
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const [role, setRole] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const response = await fetch("/api/auth/me");
      const data = (await response.json()) as {
        user: { role: string; name: string; email: string } | null;
      };
      if (data.user) {
        setRole(data.user.role);
        setBuyerName(data.user.name);
        setBuyerEmail(data.user.email);
      }
    })();
  }, []);

  const total = useMemo(
    () => items.reduce((sum, item) => sum + item.priceUsd, 0),
    [items],
  );

  const handleCheckout = async () => {
    setIsCheckingOut(true);
    setCheckoutMessage("");

    const response = await fetch("/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        buyerName,
        buyerEmail,
        items: items.map((item) => ({ imageId: item.imageId, priceUsd: item.priceUsd })),
      }),
    });

    const data = (await response.json()) as {
      ok: boolean;
      message: string;
      orderId?: string;
      checkoutStatus?: "paid" | "requires_redirect" | "failed";
      checkoutUrl?: string;
    };
    setCheckoutMessage(data.message);
    setIsCheckingOut(false);

    if (data.ok && data.checkoutStatus === "requires_redirect" && data.checkoutUrl) {
      window.location.href = data.checkoutUrl;
      return;
    }

    if (data.ok && data.checkoutStatus === "paid") {
      setLastOrderId(data.orderId ?? "");
      clearCart();
      setItems([]);
      setCheckoutComplete(true);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <header>
        <p className="text-xs uppercase tracking-wide text-slate-500">Licensing Checkout</p>
        <h1 className="text-3xl font-semibold text-slate-900">Shopping Cart</h1>
      </header>

      {items.length === 0 ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
          {checkoutComplete
            ? "Order complete. Download links and license receipts would be emailed automatically."
            : "Your cart is empty. Browse the catalog to add image licenses."}
          <div className="mt-3">
            <Link href="/" className="font-medium text-blue-700 hover:underline">
              Return to catalog search
            </Link>
            {checkoutComplete && lastOrderId ? (
              <span className="mx-2 text-slate-400">|</span>
            ) : null}
            {checkoutComplete && lastOrderId ? (
              <Link href={`/orders/${lastOrderId}`} className="font-medium text-blue-700 hover:underline">
                View license receipt
              </Link>
            ) : null}
          </div>
        </section>
      ) : (
        <>
          <section className="space-y-3">
            {items.map((item) => (
              <article
                key={item.imageId}
                className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-3"
              >
                <Image
                  src={item.previewUrl}
                  alt={item.title}
                  width={112}
                  height={80}
                  className="h-20 w-28 rounded-lg object-cover"
                />
                <div className="flex-1">
                  <h2 className="font-medium text-slate-900">{item.title}</h2>
                  <p className="text-sm text-slate-600">${item.priceUsd}</p>
                </div>
              </article>
            ))}
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5">
            {role !== "BUYER" && role !== "ADMIN" ? (
              <div className="mb-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                Buyer/admin login required for checkout.{" "}
                <Link href="/login?next=/cart" className="underline">
                  Sign in
                </Link>
              </div>
            ) : null}
            <div className="grid gap-2 pb-4 md:grid-cols-2">
              <input
                value={buyerName}
                onChange={(event) => setBuyerName(event.target.value)}
                placeholder="Buyer name"
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
              />
              <input
                value={buyerEmail}
                onChange={(event) => setBuyerEmail(event.target.value)}
                placeholder="Buyer email"
                type="email"
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <p className="text-sm text-slate-600">License total</p>
            <p className="text-2xl font-semibold text-slate-900">${total}</p>
            <button
              type="button"
              onClick={handleCheckout}
              disabled={isCheckingOut || (role !== "BUYER" && role !== "ADMIN")}
              className="mt-3 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-60"
            >
              {isCheckingOut ? "Processing..." : "Complete Checkout"}
            </button>
            {checkoutMessage ? (
              <p className="mt-3 text-sm text-slate-700">{checkoutMessage}</p>
            ) : null}
          </section>
        </>
      )}
    </div>
  );
}
