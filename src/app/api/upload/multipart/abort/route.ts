import { AbortMultipartUploadCommand } from "@aws-sdk/client-s3";
import { NextRequest, NextResponse } from "next/server";
import { decodeSession, SESSION_COOKIE_NAME } from "@/lib/session";
import { getS3BucketName, getS3Client } from "@/lib/s3";

type Body = {
  key?: string;
  uploadId?: string;
};

export async function POST(request: NextRequest) {
  const session = decodeSession(request.cookies.get(SESSION_COOKIE_NAME)?.value ?? null);
  if (!session || (session.role !== "PHOTOGRAPHER" && session.role !== "ADMIN")) {
    return NextResponse.json(
      { ok: false, message: "Photographer or admin login required." },
      { status: 403 },
    );
  }

  const body = (await request.json()) as Body;
  if (!body.key || !body.uploadId) {
    return NextResponse.json(
      { ok: false, message: "key and uploadId are required." },
      { status: 400 },
    );
  }

  const bucket = getS3BucketName();
  const s3 = getS3Client();
  if (!bucket || !s3) {
    return NextResponse.json(
      { ok: false, message: "S3 is not configured. Set bucket + credentials." },
      { status: 500 },
    );
  }

  await s3.send(
    new AbortMultipartUploadCommand({
      Bucket: bucket,
      Key: body.key,
      UploadId: body.uploadId,
    }),
  );

  return NextResponse.json({ ok: true });
}
