import sharp from "sharp";

function dataUrlToBuffer(dataUrl: string): Buffer | null {
  const base64Marker = "base64,";
  const markerIndex = dataUrl.indexOf(base64Marker);
  if (markerIndex === -1) return null;
  const payload = dataUrl.slice(markerIndex + base64Marker.length);
  if (!payload) return null;
  return Buffer.from(payload, "base64");
}

/**
 * Upper-center crop typical for red-carpet portraits (head + torso, less backdrop).
 * Helps visual re-ID when the full frame is dominated by logos.
 */
export async function makePortraitReidCropDataUrl(input: Buffer | string): Promise<string | undefined> {
  try {
    const inputBytes = Buffer.isBuffer(input) ? input : dataUrlToBuffer(input);
    if (!inputBytes || inputBytes.length < 32) return undefined;
    const meta = await sharp(inputBytes).metadata();
    const w = meta.width ?? 0;
    const h = meta.height ?? 0;
    if (w < 64 || h < 64) return undefined;
    const left = Math.max(0, Math.floor(w * 0.22));
    const top = Math.max(0, Math.floor(h * 0.08));
    const width = Math.min(w - left, Math.floor(w * 0.56));
    const height = Math.min(h - top, Math.floor(h * 0.62));
    if (width < 32 || height < 32) return undefined;
    const buf = await sharp(inputBytes)
      .extract({ left, top, width, height })
      .resize({
        width: 896,
        height: 896,
        fit: "inside",
        withoutEnlargement: true,
      })
      .png()
      .toBuffer();
    return `data:image/png;base64,${buf.toString("base64")}`;
  } catch {
    return undefined;
  }
}
