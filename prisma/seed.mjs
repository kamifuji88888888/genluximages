import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const photographers = [
  { email: "ajordan@genluximages.com", name: "A. Jordan", role: "PHOTOGRAPHER" },
  { email: "rclarke@genluximages.com", name: "R. Clarke", role: "PHOTOGRAPHER" },
  { email: "keverett@genluximages.com", name: "K. Everett", role: "PHOTOGRAPHER" },
  { email: "tokafor@genluximages.com", name: "T. Okafor", role: "PHOTOGRAPHER" },
];

const buyer = { email: "desk@metronews.com", name: "Metro News Desk", role: "BUYER" };
const admin = { email: "admin@genluximages.com", name: "GENLUX Admin", role: "ADMIN" };

const catalog = [
  {
    title: "Arrival at Climate Summit Main Hall",
    eventName: "Global Climate Summit 2026",
    eventSlug: "global-climate-summit-2026",
    location: "San Francisco, CA",
    capturedAt: "2026-01-14T10:22:00.000Z",
    photographerEmail: "ajordan@genluximages.com",
    tags: "summit,climate,arrival,editorial",
    attendeeKeywords: "vip-entry,badge-114,main-hall",
    usageRights: "editorial",
    priceUsd: 225,
    filename: "2026-01-14_global-climate-summit_arrival-mainhall_ajordan_001.jpg",
    previewUrl:
      "https://images.unsplash.com/photo-1505373877841-8d25f7d46678?auto=format&fit=crop&w=1200&q=80",
    fullResUrl:
      "https://images.unsplash.com/photo-1505373877841-8d25f7d46678?auto=format&fit=crop&w=3200&q=95",
  },
  {
    title: "Keynote Crowd Applause",
    eventName: "Global Climate Summit 2026",
    eventSlug: "global-climate-summit-2026",
    location: "San Francisco, CA",
    capturedAt: "2026-01-14T13:40:00.000Z",
    photographerEmail: "rclarke@genluximages.com",
    tags: "crowd,keynote,conference",
    attendeeKeywords: "badge-205,front-row,press-pit",
    usageRights: "editorial",
    priceUsd: 195,
    filename: "2026-01-14_global-climate-summit_keynote-crowd_rclarke_019.jpg",
    previewUrl:
      "https://images.unsplash.com/photo-1511578314322-379afb476865?auto=format&fit=crop&w=1200&q=80",
    fullResUrl:
      "https://images.unsplash.com/photo-1511578314322-379afb476865?auto=format&fit=crop&w=3200&q=95",
  },
  {
    title: "Designer Entrance on Red Carpet",
    eventName: "NOVA Fashion Week Night 2",
    eventSlug: "nova-fashion-week-night-2",
    location: "New York, NY",
    capturedAt: "2026-02-02T20:15:00.000Z",
    photographerEmail: "keverett@genluximages.com",
    tags: "fashion,red-carpet,runway",
    attendeeKeywords: "table-a3,backstage-pass",
    usageRights: "commercial",
    priceUsd: 360,
    filename: "2026-02-02_nova-fashion-week_redcarpet_keverett_102.jpg",
    previewUrl:
      "https://images.unsplash.com/photo-1521334884684-d80222895322?auto=format&fit=crop&w=1200&q=80",
    fullResUrl:
      "https://images.unsplash.com/photo-1521334884684-d80222895322?auto=format&fit=crop&w=3200&q=95",
  },
  {
    title: "Runway Finale Pose",
    eventName: "NOVA Fashion Week Night 2",
    eventSlug: "nova-fashion-week-night-2",
    location: "New York, NY",
    capturedAt: "2026-02-02T22:08:00.000Z",
    photographerEmail: "keverett@genluximages.com",
    tags: "runway,finale,model",
    attendeeKeywords: "table-b5,finale-look",
    usageRights: "commercial",
    priceUsd: 390,
    filename: "2026-02-02_nova-fashion-week_runway-finale_keverett_166.jpg",
    previewUrl:
      "https://images.unsplash.com/photo-1519741497674-611481863552?auto=format&fit=crop&w=1200&q=80",
    fullResUrl:
      "https://images.unsplash.com/photo-1519741497674-611481863552?auto=format&fit=crop&w=3200&q=95",
  },
  {
    title: "City Marathon Finish Line Sprint",
    eventName: "Metro City Marathon 2026",
    eventSlug: "metro-city-marathon-2026",
    location: "Chicago, IL",
    capturedAt: "2026-01-21T11:03:00.000Z",
    photographerEmail: "tokafor@genluximages.com",
    tags: "sports,marathon,finish-line",
    attendeeKeywords: "bib-4481,bib-4520,finish-gate",
    usageRights: "editorial",
    priceUsd: 145,
    filename: "2026-01-21_metro-city-marathon_finishline_tokafor_411.jpg",
    previewUrl:
      "https://images.unsplash.com/photo-1461896836934-ffe607ba8211?auto=format&fit=crop&w=1200&q=80",
    fullResUrl:
      "https://images.unsplash.com/photo-1461896836934-ffe607ba8211?auto=format&fit=crop&w=3200&q=95",
  },
];

async function main() {
  for (const photographer of photographers) {
    await prisma.user.upsert({
      where: { email: photographer.email },
      update: { name: photographer.name, role: photographer.role },
      create: photographer,
    });
  }

  await prisma.user.upsert({
    where: { email: buyer.email },
    update: { name: buyer.name, role: buyer.role },
    create: buyer,
  });
  await prisma.user.upsert({
    where: { email: admin.email },
    update: { name: admin.name, role: admin.role },
    create: admin,
  });

  for (const image of catalog) {
    const photographer = await prisma.user.findUniqueOrThrow({
      where: { email: image.photographerEmail },
    });

    await prisma.imageAsset.upsert({
      where: { filename: image.filename },
      update: {
        title: image.title,
        eventName: image.eventName,
        eventSlug: image.eventSlug,
        location: image.location,
        capturedAt: new Date(image.capturedAt),
        tags: image.tags,
        attendeeKeywords: image.attendeeKeywords,
        usageRights: image.usageRights,
        priceUsd: image.priceUsd,
        previewUrl: image.previewUrl,
        fullResUrl: image.fullResUrl,
        status: "published",
        publishedAt: new Date(),
        photographerId: photographer.id,
      },
      create: {
        title: image.title,
        eventName: image.eventName,
        eventSlug: image.eventSlug,
        location: image.location,
        capturedAt: new Date(image.capturedAt),
        filename: image.filename,
        tags: image.tags,
        attendeeKeywords: image.attendeeKeywords,
        usageRights: image.usageRights,
        priceUsd: image.priceUsd,
        previewUrl: image.previewUrl,
        fullResUrl: image.fullResUrl,
        status: "published",
        publishedAt: new Date(),
        photographerId: photographer.id,
      },
    });
  }

  const policies = [
    {
      eventSlug: "global-climate-summit-2026",
      eventName: "Global Climate Summit 2026",
      isPrivate: false,
      accessCode: null,
      embargoUntil: null,
    },
    {
      eventSlug: "nova-fashion-week-night-2",
      eventName: "NOVA Fashion Week Night 2",
      isPrivate: true,
      accessCode: "NOVA2026VIP",
      embargoUntil: new Date("2026-03-01T00:00:00.000Z"),
    },
    {
      eventSlug: "metro-city-marathon-2026",
      eventName: "Metro City Marathon 2026",
      isPrivate: false,
      accessCode: null,
      embargoUntil: null,
    },
  ];

  for (const policy of policies) {
    await prisma.eventPolicy.upsert({
      where: { eventSlug: policy.eventSlug },
      update: {
        eventName: policy.eventName,
        isPrivate: policy.isPrivate,
        accessCode: policy.accessCode,
        embargoUntil: policy.embargoUntil,
      },
      create: policy,
    });
  }

  const defaultPresets = [
    {
      name: "Editorial Night Coverage",
      folder: "Editorial",
      scope: "team",
      eventName: "Global Climate Summit 2026",
      location: "San Francisco, CA",
      priceUsd: 195,
      usageRights: "editorial",
      tags: "conference,editorial,coverage",
      attendeeKeywords: "badge,press,podium",
      isShared: true,
      isReadOnly: true,
      createdByEmail: "admin@genluximages.com",
    },
    {
      name: "Fashion Red Carpet Package",
      folder: "Fashion",
      scope: "team",
      eventName: "NOVA Fashion Week Night 2",
      location: "New York, NY",
      priceUsd: 375,
      usageRights: "commercial",
      tags: "fashion,red-carpet,runway",
      attendeeKeywords: "table,backstage,vip",
      isShared: true,
      isReadOnly: true,
      createdByEmail: "admin@genluximages.com",
    },
  ];

  for (const preset of defaultPresets) {
    const creator = await prisma.user.findUniqueOrThrow({
      where: { email: preset.createdByEmail },
    });
    const existing = await prisma.uploadPreset.findFirst({
      where: { name: preset.name, createdById: creator.id },
    });

    if (existing) {
      await prisma.uploadPreset.update({
        where: { id: existing.id },
        data: {
          eventName: preset.eventName,
          folder: preset.folder,
          scope: preset.scope,
          location: preset.location,
          priceUsd: preset.priceUsd,
          usageRights: preset.usageRights,
          tags: preset.tags,
          attendeeKeywords: preset.attendeeKeywords,
          isShared: preset.isShared,
          isReadOnly: preset.isReadOnly,
          approvedById: preset.isReadOnly ? creator.id : null,
        },
      });
      continue;
    }

    await prisma.uploadPreset.create({
      data: {
        name: preset.name,
        folder: preset.folder,
        scope: preset.scope,
        eventName: preset.eventName,
        location: preset.location,
        priceUsd: preset.priceUsd,
        usageRights: preset.usageRights,
        tags: preset.tags,
        attendeeKeywords: preset.attendeeKeywords,
        isShared: preset.isShared,
        isReadOnly: preset.isReadOnly,
        approvedById: preset.isReadOnly ? creator.id : null,
        createdById: creator.id,
      },
    });
  }
}

main()
  .then(async () => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
