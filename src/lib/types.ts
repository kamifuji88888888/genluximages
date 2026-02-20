export type UsageRights = "editorial" | "commercial";

export type CatalogImage = {
  id: string;
  title: string;
  eventName: string;
  eventSlug: string;
  location: string;
  capturedAt: string;
  photographer: string;
  tags: string[];
  usageRights: UsageRights;
  priceUsd: number;
  filename: string;
  previewUrl: string;
};

export type CartItem = {
  imageId: string;
  title: string;
  priceUsd: number;
  previewUrl: string;
};
