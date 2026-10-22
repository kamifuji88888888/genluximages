import { readFileSync } from "fs";
import path from "path";

// Load .env
try {
  const envText = readFileSync(path.join(process.cwd(), ".env"), "utf8");
  for (const line of envText.split("\n")) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
} catch {
  // ignore
}

import * as g from "../src/lib/google-vision-ocr";
import * as s from "../src/lib/slate-ocr";

const imagePath =
  process.argv[2] ||
  "/Users/stephenkamifuji/.cursor/projects/Users-stephenkamifuji-Desktop-GENLUX-IMAGES/assets/2026-02-20_gli-test_subject_sk_0001-be2af5ad-3050-4166-97cb-5b835edbf2bd.png";

async function main() {
  console.log("=== Config ===");
  console.log("Vision configured:", g.isGoogleVisionConfigured());
  console.log("Handwriting hint:", g.isHandwritingHintEnabled());

  console.log("\n=== Location scoring unit checks ===");
  const upper = s.foregroundSlateLocationBonus(0.5, 0.1);
  const mid = s.foregroundSlateLocationBonus(0.5, 0.55);
  const lower = s.foregroundSlateLocationBonus(0.5, 0.65);
  console.log({ upper, mid, lower, preferLower: mid > upper && lower > upper });
  console.log("pass depth lower_slate:", s.slatePassForegroundDepthBonus("focused_lower_slate"));
  console.log("pass depth full_frame:", s.slatePassForegroundDepthBonus("full_frame"));

  console.log("\n=== Name parser smoke ===");
  console.log("plain:", s.pickNameFromOcrText("Anastasija\nRadulovic"));
  console.log(
    "with noise:",
    s.pickNameFromOcrText("GENLUX LOUIS VUITTON\nAnastasija Radulovic")
  );

  if (!g.isGoogleVisionConfigured()) {
    console.log("\nSKIP live Vision: no API key");
    process.exit(0);
  }

  console.log("\n=== Live Vision OCR on sample ===");
  console.log("image:", imagePath);
  const buf = readFileSync(imagePath);
  const t0 = Date.now();
  const result = await s.runOcrOnImageBuffer(buf);
  const ms = Date.now() - t0;
  console.log(
    JSON.stringify(
      {
        ms,
        candidateName: result.candidateName,
        provider: result.provider,
        boxBonus: result.boxBonus,
        wordCount: result.words?.length ?? 0,
        rawPreview: (result.rawText || "").slice(0, 240),
      },
      null,
      2
    )
  );

  const ok =
    /anastasija/i.test(result.candidateName || "") &&
    /radulovic/i.test(result.candidateName || "");
  console.log("\nPASS name match:", ok ? "YES" : "NO");
  process.exit(ok ? 0 : 2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
