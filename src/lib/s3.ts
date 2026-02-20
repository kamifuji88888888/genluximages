import { S3Client } from "@aws-sdk/client-s3";

export function getS3BucketName() {
  return process.env.S3_BUCKET_NAME || "";
}

export function getS3Client() {
  const region = process.env.S3_REGION || "us-east-1";
  const endpoint = process.env.S3_ENDPOINT;
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;

  if (!accessKeyId || !secretAccessKey) return null;

  return new S3Client({
    region,
    endpoint: endpoint || undefined,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });
}

export function buildStorageKey(filename: string) {
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const datePart = new Date().toISOString().slice(0, 10);
  return `uploads/full/${datePart}/${Date.now()}_${safeName}`;
}

export function inferPublicUrlFromStorageKey(storageKey: string) {
  const publicBase = process.env.S3_PUBLIC_BASE_URL;
  if (!publicBase) return null;
  const normalized = publicBase.endsWith("/") ? publicBase.slice(0, -1) : publicBase;
  return `${normalized}/${storageKey}`;
}

export function getMultipartPartSizeBytes() {
  const mb = Number.parseInt(process.env.S3_MULTIPART_PART_SIZE_MB || "", 10);
  const sizeMb = Number.isNaN(mb) ? 8 : Math.max(5, mb);
  return sizeMb * 1024 * 1024;
}
