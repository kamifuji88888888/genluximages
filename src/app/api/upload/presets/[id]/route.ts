import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logPresetAudit } from "@/lib/preset-audit";
import { decodeSession, SESSION_COOKIE_NAME } from "@/lib/session";

type Params = {
  params: Promise<{ id: string }>;
};

export async function DELETE(request: NextRequest, { params }: Params) {
  const session = decodeSession(request.cookies.get(SESSION_COOKIE_NAME)?.value ?? null);
  if (!session) return NextResponse.json({ ok: false, message: "Login required." }, { status: 401 });

  const user = await db.user.findUnique({
    where: { email: session.email.toLowerCase() },
    select: { id: true, role: true },
  });
  if (!user) return NextResponse.json({ ok: false, message: "User not found." }, { status: 404 });

  const resolved = await params;
  const preset = await db.uploadPreset.findUnique({ where: { id: resolved.id } });
  if (!preset) return NextResponse.json({ ok: false, message: "Preset not found." }, { status: 404 });

  const canDelete =
    user.role === "ADMIN" || (!preset.isReadOnly && preset.createdById === user.id);
  if (!canDelete) {
    return NextResponse.json({ ok: false, message: "Not allowed to delete this preset." }, { status: 403 });
  }

  await logPresetAudit({
    presetId: preset.id,
    presetName: preset.name,
    action: "deleted",
    actorId: user.id,
    detail: `scope=${preset.scope};folder=${preset.folder};shared=${String(preset.isShared)}`,
  });
  await db.uploadPreset.delete({ where: { id: preset.id } });
  return NextResponse.json({ ok: true });
}
