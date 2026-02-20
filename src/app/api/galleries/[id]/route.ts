import { NextRequest, NextResponse } from "next/server";
import { SavedGalleryMode } from "@prisma/client";
import { db } from "@/lib/db";
import { canEditGallery, canViewGallery, getRequestUser } from "@/lib/galleries";

type Params = { params: Promise<{ id: string }> };
type UpdateBody = {
  name?: string;
  description?: string;
  mode?: SavedGalleryMode;
};

export async function GET(request: NextRequest, { params }: Params) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ ok: false, message: "Login required." }, { status: 401 });

  const resolved = await params;
  const gallery = await db.savedGallery.findUnique({
    where: { id: resolved.id },
    include: {
      owner: { select: { id: true, name: true, email: true } },
      members: { include: { user: { select: { id: true, name: true, email: true } } } },
      items: {
        include: {
          image: {
            select: {
              id: true,
              title: true,
              previewUrl: true,
              eventName: true,
              filename: true,
              priceUsd: true,
            },
          },
        },
        orderBy: { addedAt: "desc" },
      },
      shareLinks: { where: { isActive: true }, orderBy: { createdAt: "desc" } },
    },
  });
  if (!gallery) return NextResponse.json({ ok: false, message: "Gallery not found." }, { status: 404 });

  if (!(await canViewGallery(user.id, gallery))) {
    return NextResponse.json({ ok: false, message: "Not allowed to view this gallery." }, { status: 403 });
  }

  return NextResponse.json({ ok: true, gallery });
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ ok: false, message: "Login required." }, { status: 401 });

  const resolved = await params;
  const gallery = await db.savedGallery.findUnique({
    where: { id: resolved.id },
    include: { members: true },
  });
  if (!gallery) return NextResponse.json({ ok: false, message: "Gallery not found." }, { status: 404 });
  if (!(await canEditGallery(user.id, gallery))) {
    return NextResponse.json({ ok: false, message: "Not allowed to edit this gallery." }, { status: 403 });
  }

  const body = (await request.json()) as UpdateBody;
  const updated = await db.savedGallery.update({
    where: { id: gallery.id },
    data: {
      name: body.name?.trim() ?? gallery.name,
      description: body.description?.trim() ?? gallery.description,
      mode: body.mode ?? gallery.mode,
    },
  });
  return NextResponse.json({ ok: true, gallery: updated });
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ ok: false, message: "Login required." }, { status: 401 });

  const resolved = await params;
  const gallery = await db.savedGallery.findUnique({ where: { id: resolved.id } });
  if (!gallery) return NextResponse.json({ ok: false, message: "Gallery not found." }, { status: 404 });
  if (gallery.ownerId !== user.id && user.role !== "ADMIN") {
    return NextResponse.json({ ok: false, message: "Only owner/admin can delete this gallery." }, { status: 403 });
  }

  await db.savedGallery.delete({ where: { id: gallery.id } });
  return NextResponse.json({ ok: true });
}
