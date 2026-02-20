import { UploadPresetAuditAction } from "@prisma/client";
import { db } from "@/lib/db";

export async function logPresetAudit({
  presetId,
  presetName,
  action,
  actorId,
  detail,
}: {
  presetId?: string | null;
  presetName: string;
  action: UploadPresetAuditAction;
  actorId: string;
  detail?: string;
}) {
  await db.uploadPresetAudit.create({
    data: {
      presetId: presetId ?? null,
      presetName,
      action,
      actorId,
      detail: detail ?? "",
    },
  });
}
