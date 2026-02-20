export const LUXURY_CITIES = [
  { slug: "los-angeles", label: "Los Angeles" },
  { slug: "new-york", label: "New York" },
] as const;

export const LUXURY_VERTICALS = [
  { slug: "fashion", label: "Fashion" },
  { slug: "beauty", label: "Beauty" },
  { slug: "luxury-cars", label: "Luxury Cars" },
  { slug: "yachts", label: "Yachts" },
  { slug: "watches", label: "Watches" },
  { slug: "private-jets", label: "Private Jets" },
] as const;

export function getSiteUrl() {
  const fallback = "http://localhost:3000";
  const configured = process.env.NEXT_PUBLIC_APP_URL || fallback;
  try {
    return new URL(configured);
  } catch {
    return new URL(fallback);
  }
}

export function absoluteUrl(pathname = "/") {
  return new URL(pathname, getSiteUrl()).toString();
}

export function cityLabelFromSlug(slug: string) {
  return LUXURY_CITIES.find((city) => city.slug === slug)?.label ?? slug;
}

export function verticalLabelFromSlug(slug: string) {
  return LUXURY_VERTICALS.find((vertical) => vertical.slug === slug)?.label ?? slug;
}
