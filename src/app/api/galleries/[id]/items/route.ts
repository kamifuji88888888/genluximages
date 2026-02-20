import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { canEditGallery, getRequestUser } from "@/lib/galleries";

type Params = { params: Promise<{ id: string }> };
type Body = { imageId?: string; note?: string };

export async function POST(request: NextRequest, { params }: Params) {
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

  const body = (await request.json()) as Body;
  if (!body.imageId) return NextResponse.json({ ok: false, message: "imageId is required." }, { status: 400 });

  try {
    const item = await db.savedGalleryItem.create({
      data: {
        galleryId: gallery.id,
        imageId: body.imageId,
        note: body.note?.trim() ?? "",
        addedById: user.id,
      },
    });
    return NextResponse.json({ ok: true, item });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ ok: false, message: "Image already saved in this gallery." }, { status: 409 });
    }
    return NextResponse.json({ ok: false, message: "Could not add image to gallery." }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ ok: false, message: "Login required." }, { status: 401 });

  const resolved = await params;
  const imageId = request.nextUrl.searchParams.get("imageId");
  if (!imageId) return NextResponse.json({ ok: false, message: "imageId is required." }, { status: 400 });

  const gallery = await db.savedGallery.findUnique({
    where: { id: resolved.id },
    include: { members: true },
  });
  if (!gallery) return NextResponse.json({ ok: false, message: "Gallery not found." }, { status: 404 });
  if (!(await canEditGallery(user.id, gallery))) {
    return NextResponse.json({ ok: false, message: "Not allowed to edit this gallery." }, { status: 403 });
  }

  await db.savedGalleryItem.deleteMany({
    where: { galleryId: gallery.id, imageId },
  });
  return NextResponse.json({ ok: true });
}
