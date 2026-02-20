import { UploadPartCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { NextRequest, NextResponse } from "next/server";
import { decodeSession, SESSION_COOKIE_NAME } from "@/lib/session";
import { getS3BucketName, getS3Client } from "@/lib/s3";

type Body = {
  key?: string;
  uploadId?: string;
  partNumber?: number;
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
  if (!body.key || !body.uploadId || !body.partNumber) {
    return NextResponse.json(
      { ok: false, message: "key, uploadId, partNumber are required." },
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

  const command = new UploadPartCommand({
    Bucket: bucket,
    Key: body.key,
    UploadId: body.uploadId,
    PartNumber: body.partNumber,
  });
  const signedUrl = await getSignedUrl(s3, command, { expiresIn: 900 });

  return NextResponse.json({
    ok: true,
    data: { signedUrl },
  });
}
