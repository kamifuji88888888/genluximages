import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { decodeSession, SESSION_COOKIE_NAME } from "@/lib/session";

export async function GET(request: NextRequest) {
  const session = decodeSession(request.cookies.get(SESSION_COOKIE_NAME)?.value ?? null);
  if (!session || (session.role !== "PHOTOGRAPHER" && session.role !== "ADMIN")) {
    return NextResponse.json({ ok: false, message: "Photographer or admin login required." }, { status: 403 });
  }

  const user = await db.user.findFirst({
    where: { email: { equals: session.email.trim(), mode: "insensitive" } },
    select: { id: true },
  });
  if (!user) {
    return NextResponse.json({ ok: true, images: [] });
  }

  const eventSlug = request.nextUrl.searchParams.get("eventSlug")?.trim();
  const where = {
    photographerId: user.id,
    subjectNamingStatus: "needs_manual" as const,
    status: { not: "archived" as const },
    ...(eventSlug ? { eventSlug: { equals: eventSlug, mode: "insensitive" as const } } : {}),
  };

  const images = await db.imageAsset.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      title: true,
      filename: true,
      previewUrl: true,
      eventName: true,
      eventSlug: true,
      capturedAt: true,
      subjectMatchRetryCount: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ ok: true, images });
}
