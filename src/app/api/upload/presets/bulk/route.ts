import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logPresetAudit } from "@/lib/preset-audit";
import { decodeSession, SESSION_COOKIE_NAME } from "@/lib/session";

type BulkAction = "approve_read_only" | "unlock_editable" | "make_personal_private" | "delete";
type Body = { ids?: string[]; action?: BulkAction };

async function getSessionUser(request: NextRequest) {
  const session = decodeSession(request.cookies.get(SESSION_COOKIE_NAME)?.value ?? null);
  if (!session) return null;
  return db.user.findUnique({
    where: { email: session.email.toLowerCase() },
    select: { id: true, role: true },
  });
}

export async function POST(request: NextRequest) {
  const user = await getSessionUser(request);
  if (!user) return NextResponse.json({ ok: false, message: "Login required." }, { status: 401 });
  if (user.role !== "ADMIN") {
    return NextResponse.json({ ok: false, message: "Admin role required." }, { status: 403 });
  }

  const body = (await request.json()) as Body;
  if (!body.ids?.length || !body.action) {
    return NextResponse.json({ ok: false, message: "ids and action are required." }, { status: 400 });
  }

  const presets = await db.uploadPreset.findMany({
    where: { id: { in: body.ids } },
    select: { id: true, name: true },
  });

  if (!presets.length) {
    return NextResponse.json({ ok: false, message: "No matching presets found." }, { status: 404 });
  }

  if (body.action === "delete") {
    await db.uploadPreset.deleteMany({ where: { id: { in: presets.map((preset) => preset.id) } } });
    await Promise.all(
      presets.map((preset) =>
        logPresetAudit({
          presetId: preset.id,
          presetName: preset.name,
          action: "deleted",
          actorId: user.id,
          detail: "Deleted in bulk admin action",
        }),
      ),
    );
    return NextResponse.json({ ok: true, updatedCount: presets.length });
  }

  const updateData =
    body.action === "approve_read_only"
      ? { scope: "team" as const, isShared: true, isReadOnly: true, approvedById: user.id }
      : body.action === "unlock_editable"
        ? { isReadOnly: false, approvedById: null }
        : { scope: "personal" as const, isShared: false };

  await db.uploadPreset.updateMany({
    where: { id: { in: presets.map((preset) => preset.id) } },
    data: updateData,
  });

  await Promise.all(
    presets.map((preset) =>
      logPresetAudit({
        presetId: preset.id,
        presetName: preset.name,
        action: body.action === "approve_read_only" ? "approved_read_only" : "updated",
        actorId: user.id,
        detail: `Bulk action: ${body.action}`,
      }),
    ),
  );

  return NextResponse.json({ ok: true, updatedCount: presets.length });
}
