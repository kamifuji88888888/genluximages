import { NextRequest, NextResponse } from "next/server";
import { SavedGalleryMode } from "@prisma/client";
import { db } from "@/lib/db";
import { getRequestUser } from "@/lib/galleries";

type CreateBody = {
  name?: string;
  description?: string;
  mode?: SavedGalleryMode;
};

export async function GET(request: NextRequest) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ ok: false, message: "Login required." }, { status: 401 });

  const galleries = await db.savedGallery.findMany({
    where: {
      OR: [{ ownerId: user.id }, { members: { some: { userId: user.id } } }],
    },
    include: {
      owner: { select: { id: true, name: true, email: true } },
      members: { include: { user: { select: { id: true, name: true, email: true } } } },
      _count: { select: { items: true } },
    },
    orderBy: { updatedAt: "desc" },
  });

  return NextResponse.json({
    ok: true,
    galleries: galleries.map((gallery) => ({
      id: gallery.id,
      name: gallery.name,
      description: gallery.description,
      mode: gallery.mode,
      itemCount: gallery._count.items,
      owner: gallery.owner,
      members: gallery.members.map((member) => ({
        id: member.id,
        role: member.role,
        user: member.user,
      })),
      createdAt: gallery.createdAt,
      updatedAt: gallery.updatedAt,
    })),
  });
}

export async function POST(request: NextRequest) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ ok: false, message: "Login required." }, { status: 401 });

  const body = (await request.json()) as CreateBody;
  if (!body.name?.trim()) {
    return NextResponse.json({ ok: false, message: "Gallery name is required." }, { status: 400 });
  }

  const mode = body.mode ?? "private";
  const created = await db.savedGallery.create({
    data: {
      name: body.name.trim(),
      description: body.description?.trim() ?? "",
      mode,
      ownerId: user.id,
    },
  });

  return NextResponse.json({ ok: true, gallery: created });
}
