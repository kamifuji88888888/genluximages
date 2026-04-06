import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { NextRequest, NextResponse } from "next/server";
import { parseCatalogFilename } from "@/lib/filename-parser";
import { db } from "@/lib/db";
import { validateMediaFilename } from "@/lib/media-filename";
import { decodeSession, SESSION_COOKIE_NAME } from "@/lib/session";
import { getKnownSubjectsForEvent, upsertKnownSubjectForEvent } from "@/lib/subject-memory";
import { isGoogleVisionConfigured } from "@/lib/google-vision-ocr";
import { chooseBestGoogleSlateOcrEntry, runOcrOnImageBuffer } from "@/lib/slate-ocr";
import { sanitizeDiagnosticCandidateName } from "@/lib/slate-ocr-text";
import { makePortraitReidCropDataUrl } from "@/lib/subject-match-crop";
import { scheduleRetryNeedsManualSubjectNaming } from "@/lib/subject-retry";
import { SUBJECT_SLATE_APPLY_MIN_CONFIDENCE } from "@/lib/subject-naming-constants";
import {
  detectSubjectNameFromCard,
  extractTitleFromVoiceTranscript,
  getSubjectMatchMinConfidence,
  matchSubjectAgainstKnown,
  rescueBoardNameFromText,
  suggestUploadMetadata,
  transcribeVoiceNoteDetailed,
} from "@/lib/upload-ai";
import {
  extractImageNumber,
  formatPhotographerName,
  WATERMARK_NUMBER_OPACITY,
  xmlEscape,
} from "@/lib/watermark";

function sanitizeFilename(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function isTruthyEnv(value: string | undefined) {
  const normalized = (value || "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function dataUrlToBuffer(dataUrl: string) {
  const base64Marker = "base64,";
  const markerIndex = dataUrl.indexOf(base64Marker);
  if (markerIndex === -1) return null;
  const payload = dataUrl.slice(markerIndex + base64Marker.length);
  if (!payload) return null;
  return Buffer.from(payload, "base64");
}

function detectWhiteboardCandidateRegion(args: {
  grayscale: Buffer;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
}) {
  const { grayscale, width, height, sourceWidth, sourceHeight } = args;
  if (width < 40 || height < 40 || sourceWidth < 40 || sourceHeight < 40) return null;

  const windowSizes = [
    { wRatio: 0.38, hRatio: 0.28 },
    { wRatio: 0.3, hRatio: 0.24 },
    { wRatio: 0.26, hRatio: 0.2 },
  ];

  let best:
    | {
        x: number;
        y: number;
        w: number;
        h: number;
        score: number;
      }
    | null = null;

  for (const size of windowSizes) {
    const winW = Math.max(18, Math.floor(width * size.wRatio));
    const winH = Math.max(14, Math.floor(height * size.hRatio));
    if (winW >= width || winH >= height) continue;
    const stepX = Math.max(4, Math.floor(winW * 0.22));
    const stepY = Math.max(4, Math.floor(winH * 0.22));
    const yStart = Math.max(0, Math.floor(height * 0.08));
    const yEnd = Math.max(yStart + 1, Math.floor(height * 0.78) - winH);

    for (let y = yStart; y <= yEnd; y += stepY) {
      for (let x = 0; x <= width - winW; x += stepX) {
        let sum = 0;
        let sumSq = 0;
        let count = 0;
        for (let yy = y; yy < y + winH; yy++) {
          const rowOffset = yy * width;
          for (let xx = x; xx < x + winW; xx++) {
            const value = grayscale[rowOffset + xx] || 0;
            sum += value;
            sumSq += value * value;
            count++;
          }
        }
        if (count === 0) continue;
        const mean = sum / count;
        const variance = Math.max(0, sumSq / count - mean * mean);
        const stdDev = Math.sqrt(variance);
        // Prefer bright windows that still contain ink/text variance.
        const score = mean + stdDev * 1.25;
        if (!best || score > best.score) {
          best = { x, y, w: winW, h: winH, score };
        }
      }
    }
  }

  if (!best) return null;

  const scaleX = sourceWidth / width;
  const scaleY = sourceHeight / height;
  const left = clamp(Math.floor(best.x * scaleX), 0, sourceWidth - 1);
  const top = clamp(Math.floor(best.y * scaleY), 0, sourceHeight - 1);
  const candidateWidth = clamp(Math.floor(best.w * scaleX), 32, sourceWidth - left);
  const candidateHeight = clamp(Math.floor(best.h * scaleY), 32, sourceHeight - top);
  if (candidateWidth < 32 || candidateHeight < 32) return null;
  return { left, top, width: candidateWidth, height: candidateHeight };
}

export async function POST(request: NextRequest) {
  const session = decodeSession(request.cookies.get(SESSION_COOKIE_NAME)?.value ?? null);
  if (!session || (session.role !== "PHOTOGRAPHER" && session.role !== "ADMIN")) {
    return NextResponse.json(
      { ok: false, message: "Photographer or admin login required." },
      { status: 403 },
    );
  }

  const photographerRecord = await db.user.findFirst({
    where: { email: { equals: session.email.trim(), mode: "insensitive" } },
    select: { id: true },
  });
  const photographerId = photographerRecord?.id ?? null;

  const formData = await request.formData();
  const file = formData.get("file");
  const voiceNote = formData.get("voiceNote");
  const autoApplySubjectMatches = formData.get("autoApplySubjectMatches") !== "0";
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, message: "A media file is required." }, { status: 400 });
  }
  if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) {
    return NextResponse.json(
      { ok: false, message: "Unsupported media type. Upload an image or video file." },
      { status: 400 },
    );
  }

  const inputBytes = Buffer.from(await file.arrayBuffer());
  const maxBytes = 25 * 1024 * 1024;
  if (inputBytes.byteLength > maxBytes) {
    return NextResponse.json(
      { ok: false, message: "Image exceeds 25MB upload limit." },
      { status: 400 },
    );
  }

  const timestamp = Date.now();
  const originalName = sanitizeFilename(file.name);
  const filenameValidation = validateMediaFilename(originalName);
  if (!filenameValidation.ok) {
    return NextResponse.json(
      {
        ok: false,
        message: filenameValidation.message,
        suggestion: filenameValidation.suggestion,
      },
      { status: 400 },
    );
  }
  if (filenameValidation.mediaKind === "video") {
    return NextResponse.json(
      {
        ok: false,
        message:
          "Video filename is valid. Video local automation is not enabled yet; upload full-res via multipart and submit metadata manually.",
      },
      { status: 415 },
    );
  }
  const ext = path.extname(originalName).toLowerCase() || ".jpg";
  const base = path.basename(originalName, ext);
  const outputName = `${base}_${timestamp}${ext}`;

  const projectRoot = process.cwd();
  const fullDir = path.join(projectRoot, "public", "uploads", "full");
  const previewDir = path.join(projectRoot, "public", "uploads", "preview");
  await mkdir(fullDir, { recursive: true });
  await mkdir(previewDir, { recursive: true });

  const fullOutputPath = path.join(fullDir, outputName);
  const previewOutputPath = path.join(previewDir, outputName);
  await writeFile(fullOutputPath, inputBytes);

  let metadata: sharp.Metadata;
  let resizedPreview: Buffer;
  try {
    metadata = await sharp(inputBytes).metadata();
    resizedPreview = await sharp(inputBytes)
      .resize({
        width: 1400,
        height: 1400,
        fit: "inside",
        withoutEnlargement: true,
      })
      .toBuffer();
  } catch {
    return NextResponse.json(
      {
        ok: false,
        message:
          "Unsupported or corrupted image file. Please upload a standard JPG/PNG/WebP export (not RAW sidecar or placeholder file).",
      },
      { status: 415 },
    );
  }
  const resizedMeta = await sharp(resizedPreview).metadata();
  const resizedWidth = resizedMeta.width ?? 1200;
  const resizedHeight = resizedMeta.height ?? 900;
  const previewHeight = Math.max(70, Math.floor(resizedHeight * 0.09));
  const baseBannerWidth = Math.max(320, Math.floor(resizedWidth * 0.46));
  const bannerWidth = baseBannerWidth + 24;
  const bannerLeft = -12;
  const contentLeft = 16;
  const bannerTop = Math.max(0, Math.floor(resizedHeight * 0.8) - Math.floor(previewHeight / 2));

  const photographerNameText = xmlEscape(formatPhotographerName(session.name));
  const imageNumber = xmlEscape(extractImageNumber(originalName));
  const textSvg = Buffer.from(`
    <svg width="${bannerWidth}" height="${previewHeight}" xmlns="http://www.w3.org/2000/svg">
      <text x="${contentLeft - bannerLeft + Math.floor(baseBannerWidth * 0.07)}" y="${Math.floor(previewHeight * 0.78)}"
        fill="white" font-size="${Math.max(5, Math.floor(previewHeight * 0.072))}"
        font-family="Futura PT, Futura, Arial, Helvetica, sans-serif" font-weight="500">CREDIT: ${photographerNameText}</text>
    </svg>
  `);
  const stripSvg = Buffer.from(`
    <svg width="${bannerWidth}" height="${previewHeight}" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="${bannerWidth}" height="${previewHeight}" fill="rgba(0,0,0,0.2)"/>
    </svg>
  `);
  const numberBadgeSvg = Buffer.from(`
    <svg width="220" height="44" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="220" height="44" rx="5" fill="rgba(0,0,0,${WATERMARK_NUMBER_OPACITY})"/>
      <text x="14" y="30" fill="white" font-size="20" font-family="Arial, Helvetica, sans-serif"
        font-weight="700">${imageNumber}</text>
    </svg>
  `);

  let logoOverlay: Buffer | null = null;
  try {
    const templatePath = path.join(projectRoot, "public", "watermark", "genlux-credit-template-4-logo-only.png");
    const templateBytes = await readFile(templatePath);
    logoOverlay = await sharp(templateBytes)
      .resize({
        width: Math.max(160, Math.floor(baseBannerWidth * 1.2)),
        height: Math.max(46, Math.floor(previewHeight * 0.63)),
        fit: "inside",
        withoutEnlargement: true,
      })
      .png()
      .toBuffer();
  } catch {
    logoOverlay = null;
  }

  const composites: sharp.OverlayOptions[] = [
    {
      input: numberBadgeSvg,
      top: Math.max(0, resizedHeight - 52),
      left: 12,
    },
  ];
  composites.push({
    input: stripSvg,
    top: bannerTop,
    left: bannerLeft,
  });
  if (logoOverlay) {
    composites.push({
      input: logoOverlay,
      top: bannerTop + Math.max(2, Math.floor(previewHeight * 0.1)),
      left: contentLeft + 8,
    });
    composites.push({
      input: textSvg,
      top: bannerTop,
      left: bannerLeft,
    });
  } else {
    composites.push({
      input: textSvg,
      top: bannerTop,
      left: bannerLeft,
    });
  }

  const preview = await sharp(resizedPreview)
    .composite(composites)
    .jpeg({ quality: 78 })
    .toBuffer();
  await writeFile(previewOutputPath, preview);

  const origin = request.nextUrl.origin;
  const previewUrl = `${origin}/uploads/preview/${outputName}`;
  const fullResUrl = `${origin}/uploads/full/${outputName}`;
  const storageKey = `local/uploads/full/${outputName}`;
  const filenameSuggestion = parseCatalogFilename(originalName);
  type SlatePassName = string;
  type SlatePassResult = {
    pass: SlatePassName;
    model: string;
    detected: boolean;
    candidateName: string;
    confidence: number;
  };
  const slatePassInputs: Array<{ pass: SlatePassName; imageDataUrl: string }> = [];
  let aiImageDataUrl: string | undefined;
  let subjectDetectionImageDataUrl: string | undefined;
  try {
    const aiImageBuffer = await sharp(inputBytes)
      .resize({
        width: 720,
        height: 720,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 72 })
      .toBuffer();
    aiImageDataUrl = `data:image/jpeg;base64,${aiImageBuffer.toString("base64")}`;

    const subjectBuffer = await sharp(inputBytes)
      .resize({
        width: 1280,
        height: 1280,
        fit: "inside",
        withoutEnlargement: true,
      })
      .png()
      .toBuffer();
    subjectDetectionImageDataUrl = `data:image/png;base64,${subjectBuffer.toString("base64")}`;
    slatePassInputs.push({
      pass: "full_frame",
      imageDataUrl: subjectDetectionImageDataUrl,
    });

    const enhancedFullBuffer = await sharp(inputBytes)
      .resize({
        width: 1280,
        height: 1280,
        fit: "inside",
        withoutEnlargement: true,
      })
      .normalise()
      .modulate({ brightness: 1.06, saturation: 0.9 })
      .sharpen({ sigma: 1.1, m1: 1, m2: 2, x1: 2, y2: 10, y3: 20 })
      .png()
      .toBuffer();
    slatePassInputs.push({
      pass: "whiteboard_enhanced_full",
      imageDataUrl: `data:image/png;base64,${enhancedFullBuffer.toString("base64")}`,
    });

    let originalWidth = metadata.width ?? 0;
    let originalHeight = metadata.height ?? 0;
    if (originalWidth < 1 || originalHeight < 1) {
      const fallbackMeta = await sharp(inputBytes)
        .rotate()
        .resize({ width: 4000, height: 4000, fit: "inside", withoutEnlargement: false })
        .metadata();
      originalWidth = fallbackMeta.width ?? 0;
      originalHeight = fallbackMeta.height ?? 0;
    }
    if (originalWidth > 0 && originalHeight > 0) {
      const scanMeta = await sharp(inputBytes)
        .resize({
          width: 320,
          height: 320,
          fit: "inside",
          withoutEnlargement: true,
        })
        .greyscale()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const scanRegion = detectWhiteboardCandidateRegion({
        grayscale: scanMeta.data,
        width: scanMeta.info.width,
        height: scanMeta.info.height,
        sourceWidth: originalWidth,
        sourceHeight: originalHeight,
      });

      /** Handheld slates: lower-mid frame (torso/hands), not upper step-and-repeat. */
      const cropPlans: Array<{
        pass: string;
        enhancedPass: string;
        leftRatio: number;
        topRatio: number;
        widthRatio: number;
        heightRatio: number;
      }> = [
        {
          pass: "focused_foreground_slate",
          enhancedPass: "whiteboard_enhanced_foreground_slate",
          leftRatio: 0.18,
          topRatio: 0.33,
          widthRatio: 0.64,
          heightRatio: 0.52,
        },
        {
          pass: "focused_foreground_slate_left",
          enhancedPass: "whiteboard_enhanced_foreground_slate_left",
          leftRatio: 0.04,
          topRatio: 0.3,
          widthRatio: 0.58,
          heightRatio: 0.55,
        },
        {
          pass: "focused_tight_center",
          enhancedPass: "whiteboard_enhanced_tight_center",
          leftRatio: 0.24,
          topRatio: 0.2,
          widthRatio: 0.44,
          heightRatio: 0.38,
        },
        {
          pass: "focused_tight_left",
          enhancedPass: "whiteboard_enhanced_tight_left",
          leftRatio: 0.14,
          topRatio: 0.2,
          widthRatio: 0.46,
          heightRatio: 0.4,
        },
        {
          pass: "focused_center",
          enhancedPass: "whiteboard_enhanced_center",
          leftRatio: 0.18,
          topRatio: 0.2,
          widthRatio: 0.64,
          heightRatio: 0.62,
        },
      ];
      if (scanRegion) {
        cropPlans.splice(2, 0, {
          pass: "focused_board_candidate",
          enhancedPass: "whiteboard_enhanced_board_candidate",
          leftRatio: scanRegion.left / originalWidth,
          topRatio: scanRegion.top / originalHeight,
          widthRatio: scanRegion.width / originalWidth,
          heightRatio: scanRegion.height / originalHeight,
        });
      }

      for (const plan of cropPlans) {
        const left = Math.max(0, Math.floor(originalWidth * plan.leftRatio));
        const top = Math.max(0, Math.floor(originalHeight * plan.topRatio));
        const width = Math.max(32, Math.floor(originalWidth * plan.widthRatio));
        const height = Math.max(32, Math.floor(originalHeight * plan.heightRatio));
        if (left + width > originalWidth || top + height > originalHeight) continue;
        const croppedBuffer = await sharp(inputBytes)
          .extract({ left, top, width, height })
          .resize({
            width: 1800,
            height: 1800,
            fit: "inside",
            withoutEnlargement: false,
          })
          .png()
          .toBuffer();
        slatePassInputs.push({
          pass: plan.pass,
          imageDataUrl: `data:image/png;base64,${croppedBuffer.toString("base64")}`,
        });

        const enhancedCropBuffer = await sharp(croppedBuffer)
          .normalise()
          .modulate({ brightness: 1.08, saturation: 0.85 })
          .sharpen({ sigma: 1.2, m1: 1, m2: 2, x1: 2, y2: 10, y3: 20 })
          .png()
          .toBuffer();
        slatePassInputs.push({
          pass: plan.enhancedPass,
          imageDataUrl: `data:image/png;base64,${enhancedCropBuffer.toString("base64")}`,
        });

        const thresholdCropBuffer = await sharp(enhancedCropBuffer)
          .grayscale()
          .normalise()
          .threshold(165)
          .png()
          .toBuffer();
        slatePassInputs.push({
          pass: `${plan.enhancedPass}_threshold`,
          imageDataUrl: `data:image/png;base64,${thresholdCropBuffer.toString("base64")}`,
        });
      }
    }
  } catch {
    aiImageDataUrl = undefined;
    subjectDetectionImageDataUrl = undefined;
    slatePassInputs.length = 0;
  }
  const matchedVoiceNote = voiceNote instanceof File && voiceNote.size > 0 ? voiceNote : null;
  const voiceNoteMatched = Boolean(matchedVoiceNote);
  let voiceTranscript = "";
  let voiceTranscriptStatus:
    | "not_provided"
    | "transcribed"
    | "empty"
    | "request_failed"
    | "unsupported_format"
    | "provider_disabled"
    | "missing_api_key" = "not_provided";
  let voiceTranscriptMessage = "No voice note matched to this media file.";
  if (matchedVoiceNote) {
    try {
      const transcriptResult = await transcribeVoiceNoteDetailed(matchedVoiceNote);
      voiceTranscript = transcriptResult.transcript || "";
      voiceTranscriptStatus = transcriptResult.status;
      voiceTranscriptMessage = transcriptResult.message;
    } catch {
      voiceTranscript = "";
      voiceTranscriptStatus = "request_failed";
      voiceTranscriptMessage = "Transcription failed due to a temporary processing error.";
    }
  }
  const voiceTitleCandidate = extractTitleFromVoiceTranscript(voiceTranscript);
  let aiSuggestion = await suggestUploadMetadata({
    filename: originalName,
    parsed: filenameSuggestion,
    imageDataUrl: aiImageDataUrl,
    voiceTranscript,
    metadata: {
      width: metadata.width,
      height: metadata.height,
      format: metadata.format,
    },
  });
  const eventSlugForSubjects = aiSuggestion.eventSlug || filenameSuggestion.eventSlug || "general";
  let subjectName = "";
  let subjectSource: "none" | "card" | "match" = "none";
  let subjectConfidence = 0;
  let slateDetected = false;
  let slateCandidateName = "";
  let slateConfidence = 0;
  let slateApplied = false;
  let slateDetectionPass: "none" | SlatePassName = "none";
  let slateModelUsed = "";
  let slateFallbackAttempted = false;
  let slateMessage = "No slate/card name detected.";
  const slatePasses: SlatePassResult[] = [];
  const primarySlateModel = (process.env.AI_UPLOAD_MODEL || "gpt-4.1-mini").trim();
  const fallbackSlateModel = (process.env.AI_UPLOAD_SLATE_FALLBACK_MODEL || "").trim();
  if (autoApplySubjectMatches && slatePassInputs.length > 0 && subjectDetectionImageDataUrl) {
    try {
      let googleSlateResult: { name: string; pass: SlatePassName } | null = null;
      if (isGoogleVisionConfigured()) {
        const passMap = new Map(slatePassInputs.map((e) => [e.pass, e.imageDataUrl]));
        const googleSlatePassOrder: SlatePassName[] = [
          "whiteboard_enhanced_foreground_slate",
          "whiteboard_enhanced_foreground_slate_threshold",
          "focused_foreground_slate",
          "whiteboard_enhanced_foreground_slate_left",
          "whiteboard_enhanced_foreground_slate_left_threshold",
          "focused_foreground_slate_left",
          "whiteboard_enhanced_board_candidate",
          "whiteboard_enhanced_board_candidate_threshold",
          "focused_board_candidate",
          "whiteboard_enhanced_tight_center",
          "whiteboard_enhanced_tight_center_threshold",
          "focused_tight_center",
          "whiteboard_enhanced_tight_left",
          "whiteboard_enhanced_tight_left_threshold",
          "focused_tight_left",
          "whiteboard_enhanced_center",
          "whiteboard_enhanced_center_threshold",
          "focused_center",
          "whiteboard_enhanced_full",
          "full_frame",
        ];
        const maxGooglePassesRaw = Number.parseInt(process.env.GOOGLE_SLATE_OCR_MAX_PASSES || "", 10);
        const maxGooglePasses = Number.isFinite(maxGooglePassesRaw)
          ? Math.min(12, Math.max(1, maxGooglePassesRaw))
          : 8;
        const googleTasks: Array<{ pass: SlatePassName; buffer: Buffer }> = [];
        for (const pass of googleSlatePassOrder) {
          const dataUrl = passMap.get(pass);
          const buf = dataUrl ? dataUrlToBuffer(dataUrl) : null;
          if (buf) googleTasks.push({ pass, buffer: buf });
          if (googleTasks.length >= maxGooglePasses) break;
        }
        if (googleTasks.length > 0) {
          try {
            const googleOcrRuns = await Promise.all(
              googleTasks.map(async ({ pass, buffer }) => {
                const { candidateName, rawText, provider } = await runOcrOnImageBuffer(buffer);
                slatePasses.push({
                  pass,
                  model: "google-vision",
                  detected: Boolean(candidateName?.trim()),
                  candidateName: candidateName || "",
                  confidence: candidateName ? 0.88 : 0,
                });
                return { pass, candidateName: candidateName || "", rawText, provider };
              })
            );
            const visionEntries = googleOcrRuns.filter((r) => r.provider === "google");
            const bestGoogle = chooseBestGoogleSlateOcrEntry(visionEntries, googleSlatePassOrder);
            if (bestGoogle?.candidateName) {
              googleSlateResult = { name: bestGoogle.candidateName, pass: bestGoogle.pass };
              slateDetected = true;
              slateCandidateName = bestGoogle.candidateName;
              slateConfidence = 0.9;
              slateModelUsed = `google-vision (${bestGoogle.pass})`;
              slateDetectionPass = bestGoogle.pass;
              slateMessage = `Slate/whiteboard text read via Google Vision (${bestGoogle.pass.replace(/_/g, " ")}).`;
            }
          } catch (e) {
            console.warn("Google Vision slate OCR (multi-pass) failed, falling back to OpenAI passes:", e);
          }
        }
      }

      const runSlatePasses = async (model: string) => {
        let bestCardResult: Awaited<ReturnType<typeof detectSubjectNameFromCard>> = {
          confidence: 0,
          source: "none",
        };
        let bestCardPass: SlatePassName = "full_frame";
        const passResults: SlatePassResult[] = [];

        const modelPassPriority: SlatePassName[] = [
          "whiteboard_enhanced_foreground_slate",
          "whiteboard_enhanced_foreground_slate_threshold",
          "focused_foreground_slate",
          "whiteboard_enhanced_foreground_slate_left",
          "whiteboard_enhanced_foreground_slate_left_threshold",
          "focused_foreground_slate_left",
          "focused_board_candidate",
          "whiteboard_enhanced_board_candidate",
          "whiteboard_enhanced_board_candidate_threshold",
          "focused_tight_center",
          "whiteboard_enhanced_tight_center",
          "whiteboard_enhanced_tight_center_threshold",
          "focused_tight_left",
          "whiteboard_enhanced_tight_left",
          "whiteboard_enhanced_tight_left_threshold",
          "focused_center",
          "whiteboard_enhanced_center",
          "whiteboard_enhanced_center_threshold",
          "whiteboard_enhanced_full",
          "full_frame",
        ];
        const passMap = new Map(slatePassInputs.map((entry) => [entry.pass, entry]));
        const orderedPasses = modelPassPriority
          .map((pass) => passMap.get(pass))
          .filter((entry): entry is { pass: SlatePassName; imageDataUrl: string } => Boolean(entry))
          .slice(0, 8);

        for (const candidatePass of orderedPasses) {
          const passResult = await detectSubjectNameFromCard({
            filename: originalName,
            imageDataUrl: candidatePass.imageDataUrl,
            modelOverride: model,
          });
          passResults.push({
            pass: candidatePass.pass,
            model,
            detected: Boolean(passResult.subjectName),
            candidateName: passResult.subjectName || "",
            confidence: passResult.confidence || 0,
          });
          if (!passResult.subjectName) continue;
          if (!bestCardResult.subjectName || passResult.confidence > bestCardResult.confidence) {
            bestCardResult = passResult;
            bestCardPass = candidatePass.pass;
          }
        }
        return { bestCardResult, bestCardPass, passResults };
      };

      let selected: {
        bestCardResult: Awaited<ReturnType<typeof detectSubjectNameFromCard>>;
        bestCardPass: SlatePassName;
        passResults: SlatePassResult[];
      };
      if (googleSlateResult) {
        selected = {
          bestCardResult: {
            subjectName: googleSlateResult.name,
            confidence: 0.9,
            source: "card",
          },
          bestCardPass: googleSlateResult.pass,
          passResults: [],
        };
      } else {
        selected = await runSlatePasses(primarySlateModel);
        slatePasses.push(...selected.passResults);
        slateModelUsed = primarySlateModel;
      }

      const shouldUseFallback =
        !selected.bestCardResult.subjectName &&
        Boolean(fallbackSlateModel) &&
        fallbackSlateModel !== primarySlateModel;
      if (shouldUseFallback) {
        slateFallbackAttempted = true;
        const fallbackRun = await runSlatePasses(fallbackSlateModel);
        slatePasses.push(...fallbackRun.passResults);
        if (fallbackRun.bestCardResult.subjectName) {
          selected = fallbackRun;
          slateModelUsed = fallbackSlateModel;
        }
      }

      const bestCardResult = selected.bestCardResult;
      const bestCardPass = selected.bestCardPass;
      slateDetectionPass = bestCardResult.subjectName ? bestCardPass : "none";

      if (!bestCardResult.subjectName) {
        const rescuePassPriority: SlatePassName[] = [
          "whiteboard_enhanced_foreground_slate_threshold",
          "whiteboard_enhanced_foreground_slate",
          "focused_foreground_slate",
          "whiteboard_enhanced_foreground_slate_left_threshold",
          "whiteboard_enhanced_foreground_slate_left",
          "focused_foreground_slate_left",
          "whiteboard_enhanced_board_candidate_threshold",
          "whiteboard_enhanced_board_candidate",
          "focused_board_candidate",
          "whiteboard_enhanced_tight_center_threshold",
          "whiteboard_enhanced_tight_center",
          "focused_tight_center",
          "whiteboard_enhanced_tight_left_threshold",
          "whiteboard_enhanced_tight_left",
          "focused_tight_left",
          "whiteboard_enhanced_center_threshold",
          "whiteboard_enhanced_center",
          "focused_center",
          "whiteboard_enhanced_full",
          "full_frame",
        ].slice(0, 8);
        const passInputMap = new Map(slatePassInputs.map((entry) => [entry.pass, entry.imageDataUrl]));
        const rescueModel = fallbackSlateModel || primarySlateModel;
        let rescueBest: { name: string; confidence: number; pass: SlatePassName } | null = null;
        for (const pass of rescuePassPriority) {
          const imageDataUrl = passInputMap.get(pass);
          if (!imageDataUrl) continue;
          const rescue = await rescueBoardNameFromText({
            filename: originalName,
            imageDataUrl,
            modelOverride: rescueModel,
          });
          slatePasses.push({
            pass,
            model: `${rescueModel} (rescue)`,
            detected: Boolean(rescue.candidateName),
            candidateName: rescue.candidateName || rescue.rawBoardText || "",
            confidence: rescue.confidence || 0,
          });
          if (!rescue.candidateName) continue;
          if (!rescueBest || rescue.confidence > rescueBest.confidence) {
            rescueBest = { name: rescue.candidateName, confidence: rescue.confidence, pass };
          }
        }
        if (rescueBest) {
          slateDetectionPass = rescueBest.pass;
          slateDetected = true;
          slateCandidateName = rescueBest.name;
          slateConfidence = Math.max(SUBJECT_SLATE_APPLY_MIN_CONFIDENCE, rescueBest.confidence);
          slateModelUsed = rescueModel;
          slateFallbackAttempted = slateFallbackAttempted || Boolean(fallbackSlateModel);
        }
        // Local Tesseract OCR removed: it crashes on Railway (MODULE_NOT_FOUND).
        // Use GOOGLE_CLOUD_VISION_API_KEY for slate OCR instead.
      }

      if (bestCardResult.subjectName) {
        slateDetected = true;
        slateCandidateName = bestCardResult.subjectName;
        slateConfidence = bestCardResult.confidence;
        slateMessage =
          bestCardResult.confidence >= SUBJECT_SLATE_APPLY_MIN_CONFIDENCE
            ? `Slate/card name detected with high confidence (${slateModelUsed || primarySlateModel}).`
            : "Slate/card text found but confidence is below auto-apply threshold.";
      } else if (slateDetected) {
        slateMessage = `Slate/card name recovered via OCR text rescue (${slateModelUsed || primarySlateModel}).`;
      } else if (slateFallbackAttempted) {
        slateMessage = "No slate/card name detected after primary + fallback model passes.";
      }

      const finalCardName = (slateCandidateName || bestCardResult.subjectName || "").trim();
      const finalCardConfidence = Math.max(slateConfidence, bestCardResult.confidence || 0);
      const cardWouldApply =
        Boolean(finalCardName) && finalCardConfidence >= SUBJECT_SLATE_APPLY_MIN_CONFIDENCE;

      const matchMin = getSubjectMatchMinConfidence();
      let knownSubjects: Awaited<ReturnType<typeof getKnownSubjectsForEvent>> = [];
      let matchResult: Awaited<ReturnType<typeof matchSubjectAgainstKnown>> = {
        confidence: 0,
        source: "none",
      };
      if (photographerId && subjectDetectionImageDataUrl) {
        knownSubjects = await getKnownSubjectsForEvent({
          photographerId,
          eventSlug: eventSlugForSubjects,
        });
        if (knownSubjects.length > 0) {
          const portraitReidCrop = await makePortraitReidCropDataUrl(inputBytes);
          matchResult = await matchSubjectAgainstKnown({
            imageDataUrl: subjectDetectionImageDataUrl,
            portraitCropDataUrl: portraitReidCrop,
            knownSubjects,
          });
        }
      }

      const visualStrong = Boolean(
        matchResult.subjectName && matchResult.confidence >= matchMin,
      );
      const cardNorm = finalCardName.toLowerCase();
      const cardNameIsKnown =
        cardWouldApply &&
        knownSubjects.some((k) => k.name.trim().toLowerCase() === cardNorm);

      /** Backdrop OCR often reads logos; if that string is not a known attendee but face-match is, prefer match. */
      const preferVisualOverBackdropCard =
        Boolean(photographerId && subjectDetectionImageDataUrl) &&
        visualStrong &&
        cardWouldApply &&
        !cardNameIsKnown;

      if (
        preferVisualOverBackdropCard &&
        matchResult.subjectName &&
        photographerId &&
        subjectDetectionImageDataUrl
      ) {
        subjectName = matchResult.subjectName;
        subjectSource = "match";
        subjectConfidence = matchResult.confidence;
        slateApplied = false;
        slateMessage = `Matched "${matchResult.subjectName}" from an earlier tagged photo. OCR suggested "${finalCardName}", which is not someone already named for this event, so the face match was used instead.`;
        await upsertKnownSubjectForEvent({
          photographerId,
          eventSlug: eventSlugForSubjects,
          name: subjectName,
          referenceImageDataUrl: subjectDetectionImageDataUrl,
        });
        scheduleRetryNeedsManualSubjectNaming({
          photographerId,
          eventSlug: eventSlugForSubjects,
        });
      } else if (cardWouldApply) {
        subjectName = finalCardName;
        subjectSource = "card";
        subjectConfidence = finalCardConfidence;
        slateApplied = true;
        if (photographerId && subjectDetectionImageDataUrl) {
          await upsertKnownSubjectForEvent({
            photographerId,
            eventSlug: eventSlugForSubjects,
            name: subjectName,
            referenceImageDataUrl: subjectDetectionImageDataUrl,
          });
          scheduleRetryNeedsManualSubjectNaming({
            photographerId,
            eventSlug: eventSlugForSubjects,
          });
        }
      } else if (photographerId && subjectDetectionImageDataUrl && visualStrong && matchResult.subjectName) {
        subjectName = matchResult.subjectName;
        subjectSource = "match";
        subjectConfidence = matchResult.confidence;
        slateMessage = `No readable slate in this image; matched "${matchResult.subjectName}" from people you already tagged for this event (visual match).`;
      }
    } catch (err) {
      console.error("Slate/card pipeline error:", err);
      subjectName = "";
      subjectSource = "none";
      subjectConfidence = 0;
      slateDetected = false;
      slateCandidateName = "";
      slateConfidence = 0;
      slateApplied = false;
      slateDetectionPass = "none";
      slateModelUsed = "";
      slateFallbackAttempted = false;
      slateMessage = "Slate/card OCR step failed.";
    }

    if (!subjectName && slatePasses.length > 0) {
      const ranked = slatePasses
        .filter((p) => p.detected && p.candidateName.trim())
        .map((p) => ({
          p,
          cleaned: sanitizeDiagnosticCandidateName(p.candidateName),
        }))
        .filter((x) => x.cleaned.length >= 3)
        .sort(
          (a, b) =>
            b.p.confidence - a.p.confidence || b.cleaned.length - a.cleaned.length,
        );
      const top = ranked[0];
      if (top) {
        const normalizedExisting = sanitizeDiagnosticCandidateName(slateCandidateName);
        const needsSet =
          !slateCandidateName.trim() ||
          normalizedExisting !== top.cleaned ||
          slateCandidateName.trim() !== top.cleaned;
        if (needsSet) {
          slateCandidateName = top.cleaned;
          slateDetected = true;
          slateConfidence = Math.max(slateConfidence, top.p.confidence);
          slateDetectionPass = top.p.pass as SlatePassName;
          slateModelUsed = top.p.model;
          slateMessage = `${ranked.length} OCR pass(es) found a name. Top: "${top.cleaned}". Click a pass in the UI or Apply to form.`;
        }
      }
    }
  } else if (!autoApplySubjectMatches) {
    slateMessage = "Slate/card detection is disabled (auto-apply subject matches is off).";
  } else {
    slateMessage = "Slate/card OCR inputs were not generated from this image.";
  }
  let subjectNamingStatusResponse: "from_slate" | "from_match" | "needs_manual" | null = null;
  if (subjectName) {
    if (subjectSource === "card") subjectNamingStatusResponse = "from_slate";
    else if (subjectSource === "match") subjectNamingStatusResponse = "from_match";
  } else if (
    autoApplySubjectMatches &&
    slatePassInputs.length > 0 &&
    subjectDetectionImageDataUrl
  ) {
    subjectNamingStatusResponse = "needs_manual";
  }

  if (subjectName) {
    aiSuggestion = {
      ...aiSuggestion,
      suggestedTitle: subjectName,
      suggestedTags: Array.from(
        new Set([
          subjectName.toLowerCase().replace(/\s+/g, "-"),
          ...aiSuggestion.suggestedTags,
        ]),
      ).slice(0, 14),
      captionDraft: aiSuggestion.captionDraft?.toLowerCase().includes(subjectName.toLowerCase())
        ? aiSuggestion.captionDraft
        : `${subjectName}. ${aiSuggestion.captionDraft || ""}`.trim(),
      confidence: Math.max(aiSuggestion.confidence, Math.min(0.95, subjectConfidence)),
    };
  } else if (slateCandidateName.trim()) {
    const sc = sanitizeDiagnosticCandidateName(slateCandidateName).trim() || slateCandidateName.trim();
    aiSuggestion = {
      ...aiSuggestion,
      suggestedTitle: sc,
      suggestedTags: Array.from(
        new Set([sc.toLowerCase().replace(/\s+/g, "-"), ...aiSuggestion.suggestedTags]),
      ).slice(0, 14),
      captionDraft: aiSuggestion.captionDraft?.toLowerCase().includes(sc.toLowerCase())
        ? aiSuggestion.captionDraft
        : `${sc}. ${aiSuggestion.captionDraft || ""}`.trim(),
      confidence: Math.max(aiSuggestion.confidence, Math.min(0.9, slateConfidence)),
    };
  }

  return NextResponse.json({
    ok: true,
    message: `File uploaded. Preview watermark generated and metadata suggestions ready (${aiSuggestion.source}).`,
    data: {
      filename: originalName,
      previewUrl,
      fullResUrl,
      storageKey,
      width: metadata.width,
      height: metadata.height,
      suggestions: {
        capturedAt: aiSuggestion.capturedAt || filenameSuggestion.capturedAt,
        eventSlug: aiSuggestion.eventSlug || filenameSuggestion.eventSlug,
        suggestedEventName: aiSuggestion.suggestedEventName || filenameSuggestion.suggestedEventName,
        suggestedTitle: aiSuggestion.suggestedTitle || filenameSuggestion.suggestedTitle,
        suggestedLocation: aiSuggestion.suggestedLocation || "",
        suggestedTags: aiSuggestion.suggestedTags,
        suggestedAttendeeKeywords: aiSuggestion.suggestedAttendeeKeywords,
        captionDraft: aiSuggestion.captionDraft || "",
        voiceTranscript,
        voiceNoteMatched,
        voiceTranscriptStatus,
        voiceTranscriptMessage,
        voiceTitleCandidate,
        voiceTitleApplied:
          Boolean(voiceTitleCandidate) &&
          aiSuggestion.suggestedTitle?.toLowerCase() === voiceTitleCandidate.toLowerCase(),
        slateDetected,
        slateCandidateName,
        slateConfidence,
        slateApplied,
        slateDetectionPass,
        slateModelUsed,
        slateFallbackAttempted,
        slateMessage,
        slatePasses,
        subjectName: subjectName || "",
        subjectSource,
        subjectConfidence,
        subjectNamingStatus: subjectNamingStatusResponse,
        confidence: aiSuggestion.confidence,
        source: aiSuggestion.source,
      },
      previewWatermarkHeight: previewHeight,
    },
  });
}
