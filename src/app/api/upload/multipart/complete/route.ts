import { CompleteMultipartUploadCommand } from "@aws-sdk/client-s3";
import { NextRequest, NextResponse } from "next/server";
import { decodeSession, SESSION_COOKIE_NAME } from "@/lib/session";
import { getS3BucketName, getS3Client, inferPublicUrlFromStorageKey } from "@/lib/s3";

type Body = {
  key?: string;
  uploadId?: string;
  parts?: Array<{ PartNumber: number; ETag: string }>;
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
  if (!body.key || !body.uploadId || !body.parts || body.parts.length === 0) {
    return NextResponse.json(
      { ok: false, message: "key, uploadId, and parts are required." },
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

  const completed = await s3.send(
    new CompleteMultipartUploadCommand({
      Bucket: bucket,
      Key: body.key,
      UploadId: body.uploadId,
      MultipartUpload: {
        Parts: body.parts
          .map((part) => ({
            ETag: part.ETag,
            PartNumber: part.PartNumber,
          }))
          .sort((a, b) => (a.PartNumber ?? 0) - (b.PartNumber ?? 0)),
      },
    }),
  );

  if (!completed.ETag) {
    return NextResponse.json({ ok: false, message: "Failed to complete multipart upload." }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    data: {
      storageKey: body.key,
      fullResUrl: inferPublicUrlFromStorageKey(body.key),
      etag: completed.ETag,
    },
  });
}
