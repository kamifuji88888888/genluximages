import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

type Params = { params: Promise<{ token: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const resolved = await params;
  const link = await db.savedGalleryShareLink.findUnique({
    where: { token: resolved.token },
    include: {
      gallery: {
        include: {
          owner: { select: { id: true, name: true } },
          items: {
            include: {
              image: {
                select: {
                  id: true,
                  title: true,
                  previewUrl: true,
                  eventName: true,
                  priceUsd: true,
                },
              },
            },
            orderBy: { addedAt: "desc" },
          },
        },
      },
    },
  });

  if (!link || !link.isActive) {
    return NextResponse.json({ ok: false, message: "Share link is invalid." }, { status: 404 });
  }
  if (link.expiresAt && link.expiresAt.getTime() < Date.now()) {
    return NextResponse.json({ ok: false, message: "Share link has expired." }, { status: 410 });
  }

  return NextResponse.json({
    ok: true,
    gallery: {
      id: link.gallery.id,
      name: link.gallery.name,
      description: link.gallery.description,
      owner: link.gallery.owner,
      items: link.gallery.items.map((item) => item.image),
    },
  });
}
