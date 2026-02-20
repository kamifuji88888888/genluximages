import fs from "node:fs";
import sharp from "sharp";

const input =
  "/Users/stephenkamifuji/.cursor/projects/Users-stephenkamifuji-Desktop-GENLUX-IMAGES/assets/Screenshot_2026-02-19_at_1.38.27_PM-8b73c247-82cf-4485-9458-408fbfb2a1ce.png";
const defaultOutput =
  "/Users/stephenkamifuji/Desktop/GENLUX_IMAGES/genlux-images/public/uploads/preview/watermark-test-creditbar-current.jpg";
const plainBgOutput =
  "/Users/stephenkamifuji/Desktop/GENLUX_IMAGES/genlux-images/public/uploads/preview/watermark-test-creditbar-plain-50-black.jpg";
const usePlainBackground = process.env.WATERMARK_TEST_PLAIN_BG === "1";
const output = usePlainBackground ? plainBgOutput : defaultOutput;

async function run() {
  let resized;
  let width = 1200;
  let height = 900;
  if (usePlainBackground) {
    resized = await sharp({
      create: {
        width,
        height,
        channels: 3,
        background: { r: 0, g: 0, b: 0 },
      },
    })
      .composite([
        {
          input: Buffer.from(
            `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect width="${width}" height="${height}" fill="rgba(255,255,255,0.5)"/></svg>`,
          ),
        },
      ])
      .jpeg({ quality: 95 })
      .toBuffer();
  } else {
    const inputBytes = fs.readFileSync(input);
    resized = await sharp(inputBytes)
      .resize({
        width: 1400,
        height: 1400,
        fit: "inside",
        withoutEnlargement: true,
      })
      .toBuffer();
    const resizedMeta = await sharp(resized).metadata();
    width = resizedMeta.width ?? 1200;
    height = resizedMeta.height ?? 900;
  }
  const bannerHeight = Math.max(70, Math.floor(height * 0.09));
  const baseBannerWidth = Math.max(320, Math.floor(width * 0.46));
  const bannerWidth = baseBannerWidth + 24;
  const bannerLeft = -12;
  const contentLeft = 16;
  const bannerTop = Math.max(0, Math.floor(height * 0.8) - Math.floor(bannerHeight / 2));

  const textSvg = Buffer.from(`
    <svg width="${bannerWidth}" height="${bannerHeight}" xmlns="http://www.w3.org/2000/svg">
      <text x="${contentLeft - bannerLeft + 8 + Math.floor(baseBannerWidth * 0.01)}" y="${Math.floor(bannerHeight * 0.75)}"
        fill="white" font-size="${Math.max(10, Math.floor(bannerHeight * 0.144))}"
        font-family="Futura PT, Futura, Arial, Helvetica, sans-serif" font-weight="500">CREDIT: TEST PHOTOGRAPHER</text>
    </svg>
  `);
  const stripSvg = Buffer.from(`
    <svg width="${bannerWidth}" height="${bannerHeight}" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="${bannerWidth}" height="${bannerHeight}" fill="rgba(0,0,0,0.2)"/>
    </svg>
  `);
  const numberBadgeSvg = Buffer.from(`
    <svg width="220" height="44" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="220" height="44" rx="5" fill="rgba(0,0,0,0.56)"/>
      <text x="14" y="30" fill="white" font-size="20" font-family="Arial, Helvetica, sans-serif" font-weight="700">268831</text>
    </svg>
  `);

  const templateBytes = fs.readFileSync("/Users/stephenkamifuji/Desktop/GENLUX_IMAGES/genlux-images/public/watermark/genlux-credit-template-4-logo-only.png");
  const logoOverlay = await sharp(templateBytes)
    .resize({
      width: Math.max(160, Math.floor(baseBannerWidth * 1.2)),
      height: Math.max(46, Math.floor(bannerHeight * 0.63)),
      fit: "inside",
      withoutEnlargement: true,
    })
    .png()
    .toBuffer();

  await sharp(resized)
    .composite([
      { input: stripSvg, top: bannerTop, left: bannerLeft },
      { input: logoOverlay, top: bannerTop + Math.max(2, Math.floor(bannerHeight * 0.2)), left: contentLeft + 8 },
      { input: textSvg, top: bannerTop, left: bannerLeft },
      { input: numberBadgeSvg, top: Math.max(0, height - 52), left: 12 },
    ])
    .jpeg({ quality: 84 })
    .toFile(output);

  console.log(output);
}

run();
