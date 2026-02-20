import { NextRequest } from "next/server";
import { SavedGallery, SavedGalleryMode, SavedGalleryMemberRole } from "@prisma/client";
import { db } from "@/lib/db";
import { decodeSession, SESSION_COOKIE_NAME } from "@/lib/session";

export async function getRequestUser(request: NextRequest) {
  const session = decodeSession(request.cookies.get(SESSION_COOKIE_NAME)?.value ?? null);
  if (!session) return null;
  return db.user.findUnique({
    where: { email: session.email.toLowerCase() },
    select: { id: true, role: true, name: true, email: true },
  });
}

export async function canViewGallery(
  userId: string,
  gallery: SavedGallery & {
    members?: Array<{ userId: string; role: SavedGalleryMemberRole }>;
  },
) {
  if (gallery.ownerId === userId) return true;
  if (gallery.mode === SavedGalleryMode.team) {
    return !!gallery.members?.some((member) => member.userId === userId);
  }
  return false;
}

export async function canEditGallery(
  userId: string,
  gallery: SavedGallery & {
    members?: Array<{ userId: string; role: SavedGalleryMemberRole }>;
  },
) {
  if (gallery.ownerId === userId) return true;
  const member = gallery.members?.find((entry) => entry.userId === userId);
  return member?.role === "editor";
}
