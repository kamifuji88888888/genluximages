import { NextRequest, NextResponse } from "next/server";
import { Prisma, SubjectNamingStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { validateMediaFilename } from "@/lib/media-filename";
import { decodeSession, SESSION_COOKIE_NAME } from "@/lib/session";

export async function POST(request: NextRequest) {
  const session = decodeSession(request.cookies.get(SESSION_COOKIE_NAME)?.value ?? null);
  if (!session || (session.role !== "PHOTOGRAPHER" && session.role !== "ADMIN")) {
    return NextResponse.json(
      { ok: false, message: "Photographer or admin login required." },
      { status: 403 },
    );
  }

  const body = (await request.json()) as Partial<{
    title: string;
    photographer: string;
    eventName: string;
    location: string;
    eventSlug: string;
    capturedAt: string;
    priceUsd: string;
    usageRights: "editorial" | "commercial";
    filename: string;
    previewUrl: string;
    fullResUrl: string;
    storageKey: string;
    tags: string;
    attendeeKeywords: string;
    subjectNamingStatus: SubjectNamingStatus;
    subjectNamingConfidence: number;
  }>;

  if (
    !body.title ||
    !body.photographer ||
    !body.eventName ||
    !body.location ||
    !body.eventSlug ||
    !body.filename ||
    !body.capturedAt ||
    !body.priceUsd ||
    !body.usageRights
  ) {
    return NextResponse.json(
      { ok: false, message: "Missing required fields for cataloging." },
      { status: 400 },
    );
  }

  const filenameValidation = validateMediaFilename(body.filename);
  if (!filenameValidation.ok) {
    return NextResponse.json(
      {
        ok: false,
        message: filenameValidation.message,
        suggestion: filenameValidation.suggestion,
      },
      { status: 400 },
    );
  }
  if (filenameValidation.mediaKind !== "image") {
    return NextResponse.json(
      {
        ok: false,
        message:
          "Video records are not yet enabled in catalog submit. Keep strict naming and use image uploader for current catalog flow.",
      },
      { status: 400 },
    );
  }

  const priceUsd = Number.parseInt(body.priceUsd, 10);
  const capturedAt = new Date(body.capturedAt);
  if (Number.isNaN(priceUsd) || priceUsd < 1) {
    return NextResponse.json(
      { ok: false, message: "License price must be a positive number." },
      { status: 400 },
    );
  }

  if (Number.isNaN(capturedAt.getTime())) {
    return NextResponse.json(
      { ok: false, message: "Captured date/time is invalid." },
      { status: 400 },
    );
  }

  const allowedNaming: SubjectNamingStatus[] = [
    "needs_manual",
    "from_slate",
    "from_match",
    "manual_resolved",
  ];
  let subjectNamingStatus: SubjectNamingStatus | undefined;
  if (body.subjectNamingStatus && allowedNaming.includes(body.subjectNamingStatus)) {
    subjectNamingStatus = body.subjectNamingStatus;
  }
  let subjectNamingConfidence: number | undefined;
  if (typeof body.subjectNamingConfidence === "number" && Number.isFinite(body.subjectNamingConfidence)) {
    subjectNamingConfidence = Math.max(0, Math.min(1, body.subjectNamingConfidence));
  }

  try {
    const photographer = await db.user.upsert({
      where: { email: session.email.toLowerCase() },
      update: { name: session.name, role: session.role === "ADMIN" ? "ADMIN" : "PHOTOGRAPHER" },
      create: {
        email: session.email.toLowerCase(),
        name: session.name,
        role: session.role === "ADMIN" ? "ADMIN" : "PHOTOGRAPHER",
      },
    });

    await db.imageAsset.create({
      data: {
        title: body.title,
        eventName: body.eventName,
        eventSlug: body.eventSlug,
        location: body.location,
        capturedAt,
        filename: body.filename,
        tags: body.tags ?? "",
        attendeeKeywords: body.attendeeKeywords ?? "",
        usageRights: body.usageRights,
        priceUsd,
        previewUrl:
          body.previewUrl ||
          "https://images.unsplash.com/photo-1511578314322-379afb476865?auto=format&fit=crop&w=1200&q=80",
        fullResUrl: body.fullResUrl || null,
        storageKey: body.storageKey || null,
        status: "pending",
        photographerId: photographer.id,
        subjectNamingStatus: subjectNamingStatus ?? null,
        subjectNamingConfidence: subjectNamingConfidence ?? null,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json(
        { ok: false, message: "This filename already exists in the catalog." },
        { status: 409 },
      );
    }

    const errorMessage = error instanceof Error ? error.message : "Upload failed.";
    return NextResponse.json(
      { ok: false, message: `Could not save upload metadata: ${errorMessage}` },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    message: "Upload metadata saved and queued for editor review/publishing.",
  });
}
