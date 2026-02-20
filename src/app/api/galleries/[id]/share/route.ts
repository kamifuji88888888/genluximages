import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getRequestUser } from "@/lib/galleries";

type Params = { params: Promise<{ id: string }> };
type Body = { expiresInDays?: number };

export async function POST(request: NextRequest, { params }: Params) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ ok: false, message: "Login required." }, { status: 401 });

  const resolved = await params;
  const gallery = await db.savedGallery.findUnique({ where: { id: resolved.id } });
  if (!gallery) return NextResponse.json({ ok: false, message: "Gallery not found." }, { status: 404 });
  if (gallery.ownerId !== user.id && user.role !== "ADMIN") {
    return NextResponse.json({ ok: false, message: "Only owner/admin can create links." }, { status: 403 });
  }

  const body = (await request.json()) as Body;
  const expiresInDays = Math.max(0, Math.min(365, body.expiresInDays ?? 30));
  const expiresAt =
    expiresInDays > 0 ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000) : null;
  const token = crypto.randomBytes(20).toString("base64url");

  const link = await db.savedGalleryShareLink.create({
    data: {
      galleryId: gallery.id,
      token,
      expiresAt,
      isActive: true,
    },
  });
  await db.savedGallery.update({
    where: { id: gallery.id },
    data: { mode: "shared_link" },
  });

  return NextResponse.json({ ok: true, link });
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ ok: false, message: "Login required." }, { status: 401 });

  const resolved = await params;
  const token = request.nextUrl.searchParams.get("token");
  if (!token) return NextResponse.json({ ok: false, message: "token is required." }, { status: 400 });

  const gallery = await db.savedGallery.findUnique({ where: { id: resolved.id } });
  if (!gallery) return NextResponse.json({ ok: false, message: "Gallery not found." }, { status: 404 });
  if (gallery.ownerId !== user.id && user.role !== "ADMIN") {
    return NextResponse.json({ ok: false, message: "Only owner/admin can revoke links." }, { status: 403 });
  }

  await db.savedGalleryShareLink.updateMany({
    where: { galleryId: gallery.id, token },
    data: { isActive: false },
  });
  return NextResponse.json({ ok: true });
}
