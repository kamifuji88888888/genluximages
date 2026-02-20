import fs from "node:fs";
import sharp from "sharp";

const input =
  "/Users/stephenkamifuji/.cursor/projects/Users-stephenkamifuji-Desktop-GENLUX-IMAGES/assets/Genlux_Magazine_Event_11-20-25-268831-983b5127-32e1-46fe-a519-dbea99fa0f91.png";
const logo =
  "/Users/stephenkamifuji/Desktop/GENLUX_IMAGES/genlux-images/public/watermark/genlux-banner-logo.png";
const outputDir =
  "/Users/stephenkamifuji/Desktop/GENLUX_IMAGES/genlux-images/public/uploads/preview";

function esc(inputText) {
  return inputText
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

async function run() {
  const inputBytes = fs.readFileSync(input);
  const resized = await sharp(inputBytes)
    .resize({
      width: 1400,
      height: 1400,
      fit: "inside",
      withoutEnlargement: true,
    })
    .toBuffer();

  const meta = await sharp(resized).metadata();
  const width = meta.width ?? 1200;
  const height = meta.height ?? 900;
  const variants = [
    {
      key: "option-a-subtle",
      opacity: 0.27,
      bannerHeightRatio: 0.145,
      bannerWidthRatio: 0.66,
      yRatio: 0.73,
      logoScale: 0.66,
      numberOpacity: 0.44,
    },
    {
      key: "option-b-balanced",
      opacity: 0.34,
      bannerHeightRatio: 0.17,
      bannerWidthRatio: 0.72,
      yRatio: 0.7,
      logoScale: 0.72,
      numberOpacity: 0.56,
    },
    {
      key: "option-c-bold",
      opacity: 0.46,
      bannerHeightRatio: 0.19,
      bannerWidthRatio: 0.76,
      yRatio: 0.68,
      logoScale: 0.78,
      numberOpacity: 0.68,
    },
  ];

  const credit = esc("CREDIT: TEST PHOTOGRAPHER");
  const logoBytes = fs.readFileSync(logo);

  for (const variant of variants) {
    const bannerHeight = Math.max(98, Math.floor(height * variant.bannerHeightRatio));
    const bannerWidth = Math.max(340, Math.floor(width * variant.bannerWidthRatio));
    const bannerLeft = Math.max(0, Math.floor((width - bannerWidth) / 2));
    const bannerTop = Math.max(0, Math.floor(height * variant.yRatio) - Math.floor(bannerHeight / 2));

    const textSvg = Buffer.from(`
      <svg width="${bannerWidth}" height="${bannerHeight}" xmlns="http://www.w3.org/2000/svg">
        <rect x="0" y="0" width="${bannerWidth}" height="${bannerHeight}" fill="rgba(0,0,0,${variant.opacity})"/>
        <text x="${Math.floor(bannerWidth * 0.37)}" y="${Math.floor(bannerHeight * 0.62)}"
          fill="white" font-size="${Math.max(14, Math.floor(bannerHeight * 0.27))}"
          font-family="Arial, Helvetica, sans-serif" font-weight="600">${credit}</text>
      </svg>
    `);

    const numberSvg = Buffer.from(`
      <svg width="220" height="44" xmlns="http://www.w3.org/2000/svg">
        <rect x="0" y="0" width="220" height="44" rx="5" fill="rgba(0,0,0,${variant.numberOpacity})"/>
        <text x="14" y="30" fill="white" font-size="20" font-family="Arial, Helvetica, sans-serif" font-weight="700">268831</text>
      </svg>
    `);

    const logoOverlay = await sharp(logoBytes)
      .resize({
        height: Math.max(24, Math.floor(bannerHeight * variant.logoScale)),
        fit: "inside",
        withoutEnlargement: true,
      })
      .png()
      .toBuffer();

    const output = `${outputDir}/watermark-test-genlux-${variant.key}.jpg`;
    await sharp(resized)
      .composite([
        { input: textSvg, top: bannerTop, left: bannerLeft },
        {
          input: logoOverlay,
          top: bannerTop + Math.max(3, Math.floor(bannerHeight * 0.14)),
          left: bannerLeft + 12,
        },
        { input: numberSvg, top: Math.max(0, height - 52), left: 12 },
      ])
      .jpeg({ quality: 83 })
      .toFile(output);
    console.log(output);
  }
}

run();
