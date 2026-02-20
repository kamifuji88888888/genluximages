import { CatalogImage, UsageRights } from "@/lib/types";

export const catalogImages: CatalogImage[] = [
  {
    id: "img-001",
    title: "Arrival at Climate Summit Main Hall",
    eventName: "Global Climate Summit 2026",
    eventSlug: "global-climate-summit-2026",
    location: "San Francisco, CA",
    capturedAt: "2026-01-14T10:22:00.000Z",
    photographer: "A. Jordan",
    tags: ["summit", "climate", "arrival", "editorial"],
    usageRights: "editorial",
    priceUsd: 225,
    filename: "2026-01-14_global-climate-summit_arrival-mainhall_ajordan_001.jpg",
    previewUrl:
      "https://images.unsplash.com/photo-1505373877841-8d25f7d46678?auto=format&fit=crop&w=1200&q=80",
  },
  {
    id: "img-002",
    title: "Keynote Crowd Applause",
    eventName: "Global Climate Summit 2026",
    eventSlug: "global-climate-summit-2026",
    location: "San Francisco, CA",
    capturedAt: "2026-01-14T13:40:00.000Z",
    photographer: "R. Clarke",
    tags: ["crowd", "keynote", "conference"],
    usageRights: "editorial",
    priceUsd: 195,
    filename: "2026-01-14_global-climate-summit_keynote-crowd_rclarke_019.jpg",
    previewUrl:
      "https://images.unsplash.com/photo-1511578314322-379afb476865?auto=format&fit=crop&w=1200&q=80",
  },
  {
    id: "img-003",
    title: "Designer Entrance on Red Carpet",
    eventName: "NOVA Fashion Week Night 2",
    eventSlug: "nova-fashion-week-night-2",
    location: "New York, NY",
    capturedAt: "2026-02-02T20:15:00.000Z",
    photographer: "K. Everett",
    tags: ["fashion", "red-carpet", "runway"],
    usageRights: "commercial",
    priceUsd: 360,
    filename: "2026-02-02_nova-fashion-week_redcarpet_keverett_102.jpg",
    previewUrl:
      "https://images.unsplash.com/photo-1521334884684-d80222895322?auto=format&fit=crop&w=1200&q=80",
  },
  {
    id: "img-004",
    title: "Runway Finale Pose",
    eventName: "NOVA Fashion Week Night 2",
    eventSlug: "nova-fashion-week-night-2",
    location: "New York, NY",
    capturedAt: "2026-02-02T22:08:00.000Z",
    photographer: "K. Everett",
    tags: ["runway", "finale", "model"],
    usageRights: "commercial",
    priceUsd: 390,
    filename: "2026-02-02_nova-fashion-week_runway-finale_keverett_166.jpg",
    previewUrl:
      "https://images.unsplash.com/photo-1519741497674-611481863552?auto=format&fit=crop&w=1200&q=80",
  },
  {
    id: "img-005",
    title: "City Marathon Finish Line Sprint",
    eventName: "Metro City Marathon 2026",
    eventSlug: "metro-city-marathon-2026",
    location: "Chicago, IL",
    capturedAt: "2026-01-21T11:03:00.000Z",
    photographer: "T. Okafor",
    tags: ["sports", "marathon", "finish-line"],
    usageRights: "editorial",
    priceUsd: 145,
    filename: "2026-01-21_metro-city-marathon_finishline_tokafor_411.jpg",
    previewUrl:
      "https://images.unsplash.com/photo-1461896836934-ffe607ba8211?auto=format&fit=crop&w=1200&q=80",
  },
  {
    id: "img-006",
    title: "Celebration Team Huddle",
    eventName: "Metro City Marathon 2026",
    eventSlug: "metro-city-marathon-2026",
    location: "Chicago, IL",
    capturedAt: "2026-01-21T11:40:00.000Z",
    photographer: "T. Okafor",
    tags: ["sports", "celebration", "team"],
    usageRights: "editorial",
    priceUsd: 155,
    filename: "2026-01-21_metro-city-marathon_team-huddle_tokafor_470.jpg",
    previewUrl:
      "https://images.unsplash.com/photo-1521412644187-c49fa049e84d?auto=format&fit=crop&w=1200&q=80",
  },
];

export function searchCatalog({
  query,
  eventSlug,
  rights,
}: {
  query?: string;
  eventSlug?: string;
  rights?: UsageRights | "all";
}) {
  const normalizedQuery = query?.trim().toLowerCase();

  return catalogImages.filter((image) => {
    const queryMatch =
      !normalizedQuery ||
      image.title.toLowerCase().includes(normalizedQuery) ||
      image.eventName.toLowerCase().includes(normalizedQuery) ||
      image.tags.some((tag) => tag.toLowerCase().includes(normalizedQuery)) ||
      image.photographer.toLowerCase().includes(normalizedQuery) ||
      image.filename.toLowerCase().includes(normalizedQuery);

    const eventMatch = !eventSlug || image.eventSlug === eventSlug;
    const rightsMatch = !rights || rights === "all" || image.usageRights === rights;

    return queryMatch && eventMatch && rightsMatch;
  });
}

export function getEvents() {
  const map = new Map<string, { eventSlug: string; eventName: string; count: number }>();

  for (const image of catalogImages) {
    const existing = map.get(image.eventSlug);
    if (existing) {
      existing.count += 1;
      continue;
    }

    map.set(image.eventSlug, {
      eventSlug: image.eventSlug,
      eventName: image.eventName,
      count: 1,
    });
  }

  return [...map.values()];
}
