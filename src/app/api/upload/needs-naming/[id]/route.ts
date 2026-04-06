import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { decodeSession, SESSION_COOKIE_NAME } from "@/lib/session";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: RouteContext) {
  const session = decodeSession(request.cookies.get(SESSION_COOKIE_NAME)?.value ?? null);
  if (!session || (session.role !== "PHOTOGRAPHER" && session.role !== "ADMIN")) {
    return NextResponse.json({ ok: false, message: "Photographer or admin login required." }, { status: 403 });
  }

  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ ok: false, message: "Missing id." }, { status: 400 });
  }

  const body = (await request.json()) as Partial<{ title: string }>;
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) {
    return NextResponse.json({ ok: false, message: "Title is required." }, { status: 400 });
  }

  const user = await db.user.findFirst({
    where: { email: { equals: session.email.trim(), mode: "insensitive" } },
    select: { id: true },
  });
  if (!user) {
    return NextResponse.json({ ok: false, message: "User not found." }, { status: 404 });
  }

  const existing = await db.imageAsset.findFirst({
    where: { id, photographerId: user.id },
    select: { id: true, subjectNamingStatus: true },
  });
  if (!existing) {
    return NextResponse.json({ ok: false, message: "Image not found." }, { status: 404 });
  }

  await db.imageAsset.update({
    where: { id },
    data: {
      title,
      subjectNamingStatus: "manual_resolved",
      subjectNamingConfidence: null,
    },
  });

  return NextResponse.json({ ok: true, message: "Title saved." });
}
