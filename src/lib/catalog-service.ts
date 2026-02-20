import { UsageRights } from "@/lib/types";
import { db } from "@/lib/db";
import {
  catalogImages as fallbackImages,
  getEvents as getFallbackEvents,
  searchCatalog as searchFallbackCatalog,
} from "@/lib/catalog";

function toCatalogImage(image: {
  id: string;
  title: string;
  eventName: string;
  eventSlug: string;
  location: string;
  capturedAt: Date;
  photographer: { name: string };
  tags: string;
  usageRights: UsageRights;
  priceUsd: number;
  filename: string;
  previewUrl: string;
}) {
  return {
    id: image.id,
    title: image.title,
    eventName: image.eventName,
    eventSlug: image.eventSlug,
    location: image.location,
    capturedAt: image.capturedAt.toISOString(),
    photographer: image.photographer.name,
    tags: image.tags.split(",").map((tag) => tag.trim()).filter(Boolean),
    usageRights: image.usageRights,
    priceUsd: image.priceUsd,
    filename: image.filename,
    previewUrl: image.previewUrl,
  };
}

export async function searchCatalog({
  query,
  eventSlug,
  rights,
  allowedEventSlugs,
}: {
  query?: string;
  eventSlug?: string;
  rights?: UsageRights | "all";
  allowedEventSlugs?: string[];
}) {
  try {
    const normalizedQuery = query?.trim();
    const eventScope =
      allowedEventSlugs && allowedEventSlugs.length > 0
        ? { in: eventSlug ? [eventSlug] : allowedEventSlugs }
        : eventSlug
          ? eventSlug
          : undefined;

    const images = await db.imageAsset.findMany({
      where: {
        status: "published",
        ...(eventScope ? { eventSlug: eventScope } : {}),
        ...(rights && rights !== "all" ? { usageRights: rights } : {}),
        ...(normalizedQuery
          ? {
              OR: [
                { title: { contains: normalizedQuery } },
                { eventName: { contains: normalizedQuery } },
                { tags: { contains: normalizedQuery } },
                { attendeeKeywords: { contains: normalizedQuery } },
                { filename: { contains: normalizedQuery } },
                { photographer: { name: { contains: normalizedQuery } } },
              ],
            }
          : {}),
      },
      include: { photographer: { select: { name: true } } },
      orderBy: [{ publishedAt: "desc" }, { capturedAt: "desc" }],
    });

    return images.map(toCatalogImage);
  } catch {
    const fallback = searchFallbackCatalog({ query, eventSlug, rights });
    if (!allowedEventSlugs || allowedEventSlugs.length === 0) return fallback;
    return fallback.filter((image) => allowedEventSlugs.includes(image.eventSlug));
  }
}

export async function getEvents() {
  try {
    const grouped = await db.imageAsset.groupBy({
      by: ["eventSlug", "eventName"],
      where: { status: "published" },
      _count: { _all: true },
      orderBy: { eventName: "asc" },
    });

    return grouped.map((event) => ({
      eventSlug: event.eventSlug,
      eventName: event.eventName,
      count: event._count._all,
    }));
  } catch {
    return getFallbackEvents();
  }
}

export async function getImageById(id: string) {
  try {
    const image = await db.imageAsset.findFirst({
      where: { id, status: "published" },
      include: { photographer: { select: { name: true } } },
    });

    if (!image) return null;
    return toCatalogImage(image);
  } catch {
    return fallbackImages.find((image) => image.id === id) ?? null;
  }
}
