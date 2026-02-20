import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { decodeSession, SESSION_COOKIE_NAME } from "@/lib/session";

type Params = {
  params: Promise<{ id: string }>;
};

export async function GET(request: NextRequest, { params }: Params) {
  const session = decodeSession(request.cookies.get(SESSION_COOKIE_NAME)?.value ?? null);
  if (!session) return NextResponse.json({ ok: false, message: "Login required." }, { status: 401 });

  const user = await db.user.findUnique({
    where: { email: session.email.toLowerCase() },
    select: { id: true },
  });
  if (!user) return NextResponse.json({ ok: false, message: "User not found." }, { status: 404 });

  const resolved = await params;
  const preset = await db.uploadPreset.findUnique({ where: { id: resolved.id } });
  if (!preset) return NextResponse.json({ ok: false, message: "Preset not found." }, { status: 404 });

  const visible = preset.createdById === user.id || (preset.scope === "team" && preset.isShared);
  if (!visible) {
    return NextResponse.json({ ok: false, message: "Not allowed to view this preset history." }, { status: 403 });
  }

  const audits = await db.uploadPresetAudit.findMany({
    where: { presetId: preset.id },
    include: { actor: { select: { name: true, email: true } } },
    orderBy: { createdAt: "desc" },
    take: 30,
  });

  return NextResponse.json({
    ok: true,
    history: audits.map((entry) => ({
      id: entry.id,
      action: entry.action,
      detail: entry.detail,
      createdAt: entry.createdAt,
      actor: entry.actor,
    })),
  });
}
