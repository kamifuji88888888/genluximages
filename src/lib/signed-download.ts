import { createHmac, timingSafeEqual } from "node:crypto";

const DEFAULT_TTL_SECONDS = 300;

function getSigningSecret() {
  return process.env.DOWNLOAD_SIGNING_SECRET || "dev-download-secret";
}

function sign(payload: string) {
  return createHmac("sha256", getSigningSecret()).update(payload).digest("hex");
}

function payloadFor({
  imageId,
  orderId,
  assetUrl,
  exp,
}: {
  imageId: string;
  orderId: string;
  assetUrl: string;
  exp: number;
}) {
  return `${imageId}|${orderId}|${assetUrl}|${exp}`;
}

export function createSignedDownloadUrl({
  origin,
  imageId,
  orderId,
  assetUrl,
}: {
  origin: string;
  imageId: string;
  orderId: string;
  assetUrl: string;
}) {
  const ttl = Number.parseInt(process.env.DOWNLOAD_URL_TTL_SECONDS || "", 10);
  const ttlSeconds = Number.isNaN(ttl) ? DEFAULT_TTL_SECONDS : ttl;
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = payloadFor({ imageId, orderId, assetUrl, exp });
  const sig = sign(payload);

  const params = new URLSearchParams({
    image: imageId,
    order: orderId,
    asset: assetUrl,
    exp: String(exp),
    sig,
  });
  return `${origin}/api/download/signed?${params.toString()}`;
}

export function verifySignedDownloadUrl({
  imageId,
  orderId,
  assetUrl,
  exp,
  sig,
}: {
  imageId: string;
  orderId: string;
  assetUrl: string;
  exp: string;
  sig: string;
}) {
  const expNum = Number.parseInt(exp, 10);
  if (Number.isNaN(expNum)) return false;
  if (expNum < Math.floor(Date.now() / 1000)) return false;

  const expected = sign(payloadFor({ imageId, orderId, assetUrl, exp: expNum }));
  const provided = Buffer.from(sig, "utf8");
  const expectedBuf = Buffer.from(expected, "utf8");
  if (provided.length !== expectedBuf.length) return false;
  return timingSafeEqual(provided, expectedBuf);
}
