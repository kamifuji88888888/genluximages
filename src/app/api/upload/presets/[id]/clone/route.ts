import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logPresetAudit } from "@/lib/preset-audit";
import { decodeSession, SESSION_COOKIE_NAME } from "@/lib/session";

type Params = {
  params: Promise<{ id: string }>;
};

export async function POST(request: NextRequest, { params }: Params) {
  const session = decodeSession(request.cookies.get(SESSION_COOKIE_NAME)?.value ?? null);
  if (!session) return NextResponse.json({ ok: false, message: "Login required." }, { status: 401 });

  const user = await db.user.findUnique({
    where: { email: session.email.toLowerCase() },
    select: { id: true, role: true },
  });
  if (!user) return NextResponse.json({ ok: false, message: "User not found." }, { status: 404 });
  if (user.role !== "PHOTOGRAPHER" && user.role !== "ADMIN") {
    return NextResponse.json({ ok: false, message: "Photographer/admin role required." }, { status: 403 });
  }

  const resolved = await params;
  const source = await db.uploadPreset.findUnique({ where: { id: resolved.id } });
  if (!source) return NextResponse.json({ ok: false, message: "Preset not found." }, { status: 404 });

  const visible = source.createdById === user.id || (source.scope === "team" && source.isShared);
  if (!visible) {
    return NextResponse.json({ ok: false, message: "Not allowed to clone this preset." }, { status: 403 });
  }

  const cloned = await db.uploadPreset.create({
    data: {
      name: `${source.name} (Copy)`,
      folder: source.folder,
      scope: "personal",
      eventName: source.eventName,
      location: source.location,
      priceUsd: source.priceUsd,
      usageRights: source.usageRights,
      tags: source.tags,
      attendeeKeywords: source.attendeeKeywords,
      isShared: false,
      isReadOnly: false,
      approvedById: null,
      createdById: user.id,
    },
    include: {
      createdBy: { select: { name: true, email: true } },
      approvedBy: { select: { name: true, email: true } },
    },
  });

  await logPresetAudit({
    presetId: cloned.id,
    presetName: cloned.name,
    action: "cloned",
    actorId: user.id,
    detail: `sourcePresetId=${source.id}`,
  });

  return NextResponse.json({
    ok: true,
    preset: {
      id: cloned.id,
      name: cloned.name,
      folder: cloned.folder,
      scope: cloned.scope,
      isShared: cloned.isShared,
      isReadOnly: cloned.isReadOnly,
      createdBy: cloned.createdBy,
      approvedBy: cloned.approvedBy,
      canEdit: true,
      canDelete: true,
      canClone: true,
      defaults: {
        eventName: cloned.eventName,
        location: cloned.location,
        priceUsd: String(cloned.priceUsd),
        usageRights: cloned.usageRights,
        tags: cloned.tags,
        attendeeKeywords: cloned.attendeeKeywords,
      },
    },
  });
}
