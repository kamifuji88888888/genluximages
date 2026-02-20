import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logPresetAudit } from "@/lib/preset-audit";
import { decodeSession, SESSION_COOKIE_NAME } from "@/lib/session";

type PresetDefaults = {
  eventName: string;
  location: string;
  priceUsd: string;
  usageRights: "editorial" | "commercial";
  tags: string;
  attendeeKeywords: string;
};

type PresetBody = {
  id?: string;
  name?: string;
  folder?: string;
  scope?: "personal" | "team";
  defaults?: PresetDefaults;
  isShared?: boolean;
  isReadOnly?: boolean;
};

async function getSessionUser(request: NextRequest) {
  const session = decodeSession(request.cookies.get(SESSION_COOKIE_NAME)?.value ?? null);
  if (!session) return null;
  const user = await db.user.findUnique({
    where: { email: session.email.toLowerCase() },
    select: { id: true, role: true, name: true, email: true },
  });
  return user;
}

export async function GET(request: NextRequest) {
  const user = await getSessionUser(request);
  if (!user) return NextResponse.json({ ok: false, message: "Login required." }, { status: 401 });

  const presets = await db.uploadPreset.findMany({
    where: {
      OR: [
        { scope: "team", isShared: true },
        { createdById: user.id },
      ],
    },
    include: {
      createdBy: { select: { name: true, email: true } },
      approvedBy: { select: { name: true, email: true } },
    },
    orderBy: [{ scope: "desc" }, { folder: "asc" }, { name: "asc" }],
  });

  return NextResponse.json({
    ok: true,
    presets: presets.map((preset) => ({
      id: preset.id,
      name: preset.name,
      folder: preset.folder,
      scope: preset.scope,
      isShared: preset.isShared,
      isReadOnly: preset.isReadOnly,
      createdBy: preset.createdBy,
      approvedBy: preset.approvedBy,
      canEdit: user.role === "ADMIN" || (!preset.isReadOnly && preset.createdById === user.id),
      canDelete: user.role === "ADMIN" || (!preset.isReadOnly && preset.createdById === user.id),
      canClone: true,
      defaults: {
        eventName: preset.eventName,
        location: preset.location,
        priceUsd: String(preset.priceUsd),
        usageRights: preset.usageRights,
        tags: preset.tags,
        attendeeKeywords: preset.attendeeKeywords,
      },
    })),
  });
}

export async function POST(request: NextRequest) {
  const user = await getSessionUser(request);
  if (!user) return NextResponse.json({ ok: false, message: "Login required." }, { status: 401 });
  if (user.role !== "PHOTOGRAPHER" && user.role !== "ADMIN") {
    return NextResponse.json({ ok: false, message: "Photographer/admin role required." }, { status: 403 });
  }

  const body = (await request.json()) as PresetBody;
  if (!body.name || !body.defaults) {
    return NextResponse.json({ ok: false, message: "Preset name and defaults are required." }, { status: 400 });
  }

  const priceUsd = Number.parseInt(body.defaults.priceUsd, 10);
  if (Number.isNaN(priceUsd) || priceUsd < 1) {
    return NextResponse.json({ ok: false, message: "Preset default price is invalid." }, { status: 400 });
  }

  if (body.id) {
    const existing = await db.uploadPreset.findUnique({ where: { id: body.id } });
    if (!existing) return NextResponse.json({ ok: false, message: "Preset not found." }, { status: 404 });
    const canEdit =
      user.role === "ADMIN" || (!existing.isReadOnly && existing.createdById === user.id);
    if (!canEdit) return NextResponse.json({ ok: false, message: "Not allowed to edit this preset." }, { status: 403 });

    const scope = body.scope === "team" && user.role !== "ADMIN" ? existing.scope : body.scope ?? existing.scope;
    const isReadOnly = user.role === "ADMIN" ? (body.isReadOnly ?? existing.isReadOnly) : existing.isReadOnly;

    const updated = await db.uploadPreset.update({
      where: { id: existing.id },
      data: {
        name: body.name.trim(),
        folder: body.folder?.trim() || "General",
        scope,
        eventName: body.defaults.eventName,
        location: body.defaults.location,
        priceUsd,
        usageRights: body.defaults.usageRights,
        tags: body.defaults.tags,
        attendeeKeywords: body.defaults.attendeeKeywords,
        isShared: body.isShared ?? true,
        isReadOnly,
        approvedById: isReadOnly ? user.id : null,
      },
      include: {
        createdBy: { select: { name: true, email: true } },
        approvedBy: { select: { name: true, email: true } },
      },
    });

    await logPresetAudit({
      presetId: updated.id,
      presetName: updated.name,
      action:
        !existing.isReadOnly && isReadOnly ? "approved_read_only" : "updated",
      actorId: user.id,
      detail: `scope=${updated.scope};folder=${updated.folder};shared=${String(updated.isShared)}`,
    });

    return NextResponse.json({
      ok: true,
      preset: {
        id: updated.id,
        name: updated.name,
        folder: updated.folder,
        scope: updated.scope,
        isShared: updated.isShared,
        isReadOnly: updated.isReadOnly,
        createdBy: updated.createdBy,
        approvedBy: updated.approvedBy,
        canClone: true,
        defaults: {
          eventName: updated.eventName,
          location: updated.location,
          priceUsd: String(updated.priceUsd),
          usageRights: updated.usageRights,
          tags: updated.tags,
          attendeeKeywords: updated.attendeeKeywords,
        },
      },
    });
  }

  const scope = body.scope === "team" ? "team" : "personal";
  const readOnly = user.role === "ADMIN" ? (body.isReadOnly ?? false) : false;
  const created = await db.uploadPreset.create({
    data: {
      name: body.name.trim(),
      folder: body.folder?.trim() || "General",
      scope,
      eventName: body.defaults.eventName,
      location: body.defaults.location,
      priceUsd,
      usageRights: body.defaults.usageRights,
      tags: body.defaults.tags,
      attendeeKeywords: body.defaults.attendeeKeywords,
      isShared: body.isShared ?? true,
      isReadOnly: readOnly,
      approvedById: readOnly ? user.id : null,
      createdById: user.id,
    },
    include: {
      createdBy: { select: { name: true, email: true } },
      approvedBy: { select: { name: true, email: true } },
    },
  });

  await logPresetAudit({
    presetId: created.id,
    presetName: created.name,
    action: "created",
    actorId: user.id,
    detail: `scope=${created.scope};folder=${created.folder};shared=${String(created.isShared)}`,
  });
  return NextResponse.json({
    ok: true,
    preset: {
      id: created.id,
      name: created.name,
      folder: created.folder,
      scope: created.scope,
      isShared: created.isShared,
      isReadOnly: created.isReadOnly,
      createdBy: created.createdBy,
      approvedBy: created.approvedBy,
      canClone: true,
      defaults: {
        eventName: created.eventName,
        location: created.location,
        priceUsd: String(created.priceUsd),
        usageRights: created.usageRights,
        tags: created.tags,
        attendeeKeywords: created.attendeeKeywords,
      },
    },
  });
}
