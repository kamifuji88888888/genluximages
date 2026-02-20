import { CartItem } from "@/lib/types";

const CART_KEY = "genlux_cart_v1";

export function getCart(): CartItem[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = localStorage.getItem(CART_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as CartItem[];
  } catch {
    return [];
  }
}

export function saveCart(items: CartItem[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(CART_KEY, JSON.stringify(items));
}

export function addToCart(item: CartItem) {
  const items = getCart();
  const alreadyExists = items.some((entry) => entry.imageId === item.imageId);
  if (alreadyExists) return items;

  const updated = [...items, item];
  saveCart(updated);
  return updated;
}

export function clearCart() {
  saveCart([]);
}
