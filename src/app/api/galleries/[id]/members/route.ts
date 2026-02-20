import { NextRequest, NextResponse } from "next/server";
import { SavedGalleryMemberRole } from "@prisma/client";
import { db } from "@/lib/db";
import { getRequestUser } from "@/lib/galleries";

type Params = { params: Promise<{ id: string }> };
type Body = { email?: string; role?: SavedGalleryMemberRole };

export async function POST(request: NextRequest, { params }: Params) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ ok: false, message: "Login required." }, { status: 401 });

  const resolved = await params;
  const gallery = await db.savedGallery.findUnique({ where: { id: resolved.id } });
  if (!gallery) return NextResponse.json({ ok: false, message: "Gallery not found." }, { status: 404 });
  if (gallery.ownerId !== user.id && user.role !== "ADMIN") {
    return NextResponse.json({ ok: false, message: "Only owner/admin can manage members." }, { status: 403 });
  }

  const body = (await request.json()) as Body;
  if (!body.email) return NextResponse.json({ ok: false, message: "Member email is required." }, { status: 400 });
  const memberUser = await db.user.findUnique({
    where: { email: body.email.toLowerCase() },
    select: { id: true, email: true, name: true },
  });
  if (!memberUser) return NextResponse.json({ ok: false, message: "User not found." }, { status: 404 });

  const membership = await db.savedGalleryMember.upsert({
    where: { galleryId_userId: { galleryId: gallery.id, userId: memberUser.id } },
    update: { role: body.role ?? "viewer" },
    create: {
      galleryId: gallery.id,
      userId: memberUser.id,
      role: body.role ?? "viewer",
    },
  });
  await db.savedGallery.update({
    where: { id: gallery.id },
    data: { mode: "team" },
  });
  return NextResponse.json({ ok: true, membership });
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ ok: false, message: "Login required." }, { status: 401 });

  const resolved = await params;
  const memberId = request.nextUrl.searchParams.get("userId");
  if (!memberId) return NextResponse.json({ ok: false, message: "userId is required." }, { status: 400 });

  const gallery = await db.savedGallery.findUnique({ where: { id: resolved.id } });
  if (!gallery) return NextResponse.json({ ok: false, message: "Gallery not found." }, { status: 404 });
  if (gallery.ownerId !== user.id && user.role !== "ADMIN") {
    return NextResponse.json({ ok: false, message: "Only owner/admin can manage members." }, { status: 403 });
  }

  await db.savedGalleryMember.deleteMany({
    where: { galleryId: gallery.id, userId: memberId },
  });
  return NextResponse.json({ ok: true });
}
