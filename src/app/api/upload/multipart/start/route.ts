import { CreateMultipartUploadCommand } from "@aws-sdk/client-s3";
import { NextRequest, NextResponse } from "next/server";
import { decodeSession, SESSION_COOKIE_NAME } from "@/lib/session";
import {
  buildStorageKey,
  getMultipartPartSizeBytes,
  getS3BucketName,
  getS3Client,
} from "@/lib/s3";

type Body = {
  filename?: string;
  contentType?: string;
  sizeBytes?: number;
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
  if (!body.filename || !body.contentType || !body.sizeBytes) {
    return NextResponse.json(
      { ok: false, message: "filename, contentType, and sizeBytes are required." },
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

  const key = buildStorageKey(body.filename);
  const command = new CreateMultipartUploadCommand({
    Bucket: bucket,
    Key: key,
    ContentType: body.contentType,
  });

  const created = await s3.send(command);
  if (!created.UploadId) {
    return NextResponse.json({ ok: false, message: "Failed to start multipart upload." }, { status: 500 });
  }

  const partSizeBytes = getMultipartPartSizeBytes();
  const partCount = Math.ceil(body.sizeBytes / partSizeBytes);

  return NextResponse.json({
    ok: true,
    data: {
      uploadId: created.UploadId,
      key,
      partSizeBytes,
      partCount,
    },
  });
}
