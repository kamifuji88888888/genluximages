import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getRequestUser } from "@/lib/galleries";

type Body = {
  imageIds?: string[];
  galleryName?: string;
};

export async function POST(request: NextRequest) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ ok: false, message: "Login required." }, { status: 401 });

  const body = (await request.json()) as Body;
  const imageIds = Array.from(new Set((body.imageIds ?? []).filter(Boolean))).slice(0, 250);
  if (!imageIds.length) return NextResponse.json({ ok: true, addedCount: 0, skippedCount: 0 });

  const galleryName = body.galleryName?.trim() || "My Saved Picks";
  let gallery = await db.savedGallery.findFirst({
    where: { ownerId: user.id, name: galleryName },
    select: { id: true },
  });
  if (!gallery) {
    gallery = await db.savedGallery.create({
      data: {
        ownerId: user.id,
        name: galleryName,
        mode: "private",
      },
      select: { id: true },
    });
  }

  const existingImages = await db.imageAsset.findMany({
    where: { id: { in: imageIds } },
    select: { id: true },
  });
  const validImageIds = new Set(existingImages.map((entry) => entry.id));

  let addedCount = 0;
  let skippedCount = 0;

  for (const imageId of imageIds) {
    if (!validImageIds.has(imageId)) {
      skippedCount += 1;
      continue;
    }
    try {
      await db.savedGalleryItem.create({
        data: {
          galleryId: gallery.id,
          imageId,
          addedById: user.id,
        },
      });
      addedCount += 1;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        skippedCount += 1;
        continue;
      }
      throw error;
    }
  }

  return NextResponse.json({
    ok: true,
    galleryId: gallery.id,
    addedCount,
    skippedCount,
  });
}
