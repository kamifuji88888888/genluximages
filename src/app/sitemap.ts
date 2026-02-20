import type { MetadataRoute } from "next";
import { db } from "@/lib/db";
import { getEvents } from "@/lib/catalog-service";
import { absoluteUrl, LUXURY_CITIES, LUXURY_VERTICALS } from "@/lib/seo";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: absoluteUrl("/"), lastModified: now, changeFrequency: "daily", priority: 1 },
    { url: absoluteUrl("/luxury"), lastModified: now, changeFrequency: "weekly", priority: 0.9 },
    { url: absoluteUrl("/attendee"), lastModified: now, changeFrequency: "weekly", priority: 0.7 },
    { url: absoluteUrl("/agency"), lastModified: now, changeFrequency: "weekly", priority: 0.7 },
  ];

  const luxuryRoutes: MetadataRoute.Sitemap = LUXURY_CITIES.flatMap((city) =>
    LUXURY_VERTICALS.map((vertical) => ({
      url: absoluteUrl(`/luxury/${city.slug}/${vertical.slug}`),
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
  );

  const eventRoutes: MetadataRoute.Sitemap = (await getEvents()).map((event) => ({
    url: absoluteUrl(`/events/${event.eventSlug}`),
    lastModified: now,
    changeFrequency: "daily",
    priority: 0.8,
  }));

  let imageRoutes: MetadataRoute.Sitemap = [];
  try {
    const images = await db.imageAsset.findMany({
      where: { status: "published" },
      select: { id: true, updatedAt: true },
      orderBy: [{ updatedAt: "desc" }],
      take: 5000,
    });
    imageRoutes = images.map((image) => ({
      url: absoluteUrl(`/images/${image.id}`),
      lastModified: image.updatedAt,
      changeFrequency: "weekly",
      priority: 0.6,
    }));
  } catch {
    imageRoutes = [];
  }

  return [...staticRoutes, ...luxuryRoutes, ...eventRoutes, ...imageRoutes];
}
