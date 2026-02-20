"use client";

import { useState } from "react";
import { addToCart, getCart } from "@/lib/cart";
import { CartItem } from "@/lib/types";

export function AddToCartButton({ item }: { item: CartItem }) {
  const [inCart, setInCart] = useState(() =>
    getCart().some((entry) => entry.imageId === item.imageId),
  );

  const handleAdd = () => {
    addToCart(item);
    setInCart(true);
  };

  return (
    <button
      type="button"
      onClick={handleAdd}
      disabled={inCart}
      className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-emerald-700"
    >
      {inCart ? "Added to Cart" : "Add License to Cart"}
    </button>
  );
}
