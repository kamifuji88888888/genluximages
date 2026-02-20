import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

type DeliveryProvider = "direct" | "s3";

function getDeliveryProvider(): DeliveryProvider {
  const provider = (process.env.ASSET_DELIVERY_PROVIDER || "direct").toLowerCase();
  if (provider === "s3") return "s3";
  return "direct";
}

function getTtlSeconds() {
  const parsed = Number.parseInt(process.env.DOWNLOAD_URL_TTL_SECONDS || "", 10);
  return Number.isNaN(parsed) ? 300 : parsed;
}

function createS3Client() {
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

export async function createDeliveryUrlForAsset(asset: {
  storageKey: string | null;
  fullResUrl: string | null;
  previewUrl: string;
}) {
  const provider = getDeliveryProvider();

  if (provider === "s3") {
    const bucket = process.env.S3_BUCKET_NAME;
    const client = createS3Client();
    if (!bucket || !client || !asset.storageKey) {
      throw new Error("S3 delivery requires S3 credentials, bucket, and image storageKey.");
    }

    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: asset.storageKey,
      ResponseContentDisposition: "attachment",
    });

    return getSignedUrl(client, command, { expiresIn: getTtlSeconds() });
  }

  return asset.fullResUrl || asset.previewUrl;
}
