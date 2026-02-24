import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { NextRequest, NextResponse } from "next/server";
import { parseCatalogFilename } from "@/lib/filename-parser";
import { validateMediaFilename } from "@/lib/media-filename";
import { decodeSession, SESSION_COOKIE_NAME } from "@/lib/session";
import { getKnownSubjectsForEvent, upsertKnownSubjectForEvent } from "@/lib/subject-memory";
import {
  detectSubjectNameFromCard,
  extractTitleFromVoiceTranscript,
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

export async function POST(request: NextRequest) {
  const session = decodeSession(request.cookies.get(SESSION_COOKIE_NAME)?.value ?? null);
  if (!session || (session.role !== "PHOTOGRAPHER" && session.role !== "ADMIN")) {
    return NextResponse.json(
      { ok: false, message: "Photographer or admin login required." },
      { status: 403 },
    );
  }

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
  type SlatePassName =
    | "full_frame"
    | "focused_center"
    | "focused_lower"
    | "whiteboard_enhanced_full"
    | "whiteboard_enhanced_center"
    | "whiteboard_enhanced_lower";
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
      .jpeg({ quality: 82 })
      .toBuffer();
    subjectDetectionImageDataUrl = `data:image/jpeg;base64,${subjectBuffer.toString("base64")}`;
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
      .jpeg({ quality: 84 })
      .toBuffer();
    slatePassInputs.push({
      pass: "whiteboard_enhanced_full",
      imageDataUrl: `data:image/jpeg;base64,${enhancedFullBuffer.toString("base64")}`,
    });

    const originalWidth = metadata.width ?? 0;
    const originalHeight = metadata.height ?? 0;
    if (originalWidth > 0 && originalHeight > 0) {
      const cropPlans: Array<{
        pass: "focused_center" | "focused_lower";
        enhancedPass: "whiteboard_enhanced_center" | "whiteboard_enhanced_lower";
        leftRatio: number;
        topRatio: number;
        widthRatio: number;
        heightRatio: number;
      }> = [
        {
          pass: "focused_center",
          enhancedPass: "whiteboard_enhanced_center",
          leftRatio: 0.18,
          topRatio: 0.2,
          widthRatio: 0.64,
          heightRatio: 0.62,
        },
        {
          pass: "focused_lower",
          enhancedPass: "whiteboard_enhanced_lower",
          leftRatio: 0.2,
          topRatio: 0.38,
          widthRatio: 0.6,
          heightRatio: 0.5,
        },
      ];

      for (const plan of cropPlans) {
        const left = Math.max(0, Math.floor(originalWidth * plan.leftRatio));
        const top = Math.max(0, Math.floor(originalHeight * plan.topRatio));
        const width = Math.max(32, Math.floor(originalWidth * plan.widthRatio));
        const height = Math.max(32, Math.floor(originalHeight * plan.heightRatio));
        if (left + width > originalWidth || top + height > originalHeight) continue;
        const croppedBuffer = await sharp(inputBytes)
          .extract({ left, top, width, height })
          .resize({
            width: 1400,
            height: 1400,
            fit: "inside",
            withoutEnlargement: false,
          })
          .jpeg({ quality: 85 })
          .toBuffer();
        slatePassInputs.push({
          pass: plan.pass,
          imageDataUrl: `data:image/jpeg;base64,${croppedBuffer.toString("base64")}`,
        });

        const enhancedCropBuffer = await sharp(croppedBuffer)
          .normalise()
          .modulate({ brightness: 1.08, saturation: 0.85 })
          .sharpen({ sigma: 1.2, m1: 1, m2: 2, x1: 2, y2: 10, y3: 20 })
          .jpeg({ quality: 86 })
          .toBuffer();
        slatePassInputs.push({
          pass: plan.enhancedPass,
          imageDataUrl: `data:image/jpeg;base64,${enhancedCropBuffer.toString("base64")}`,
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
      const runSlatePasses = async (model: string) => {
        let bestCardResult: Awaited<ReturnType<typeof detectSubjectNameFromCard>> = {
          confidence: 0,
          source: "none",
        };
        let bestCardPass: SlatePassName = "full_frame";
        const passResults: SlatePassResult[] = [];

        for (const candidatePass of slatePassInputs) {
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

      let selected = await runSlatePasses(primarySlateModel);
      slatePasses.push(...selected.passResults);
      slateModelUsed = primarySlateModel;

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
          "whiteboard_enhanced_center",
          "focused_center",
          "whiteboard_enhanced_lower",
          "focused_lower",
          "whiteboard_enhanced_full",
          "full_frame",
        ];
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
          slateConfidence = Math.max(0.62, rescueBest.confidence);
          slateModelUsed = rescueModel;
          slateFallbackAttempted = slateFallbackAttempted || Boolean(fallbackSlateModel);
        }
      }

      if (bestCardResult.subjectName) {
        slateDetected = true;
        slateCandidateName = bestCardResult.subjectName;
        slateConfidence = bestCardResult.confidence;
        slateMessage =
          bestCardResult.confidence >= 0.62
            ? `Slate/card name detected with high confidence (${slateModelUsed || primarySlateModel}).`
            : "Slate/card text found but confidence is below auto-apply threshold.";
      } else if (slateDetected) {
        slateMessage = `Slate/card name recovered via OCR text rescue (${slateModelUsed || primarySlateModel}).`;
      } else if (slateFallbackAttempted) {
        slateMessage = "No slate/card name detected after primary + fallback model passes.";
      }

      const finalCardName = slateCandidateName || bestCardResult.subjectName || "";
      const finalCardConfidence = Math.max(slateConfidence, bestCardResult.confidence || 0);
      if (finalCardName && finalCardConfidence >= 0.62) {
        subjectName = finalCardName;
        subjectSource = "card";
        subjectConfidence = finalCardConfidence;
        slateApplied = true;
        upsertKnownSubjectForEvent({
          uploaderEmail: session.email,
          eventSlug: eventSlugForSubjects,
          name: subjectName,
          referenceImageDataUrl: subjectDetectionImageDataUrl,
        });
      } else {
        const knownSubjects = getKnownSubjectsForEvent({
          uploaderEmail: session.email,
          eventSlug: eventSlugForSubjects,
        });
        const matchResult = await matchSubjectAgainstKnown({
          imageDataUrl: subjectDetectionImageDataUrl,
          knownSubjects,
        });
        if (matchResult.subjectName && matchResult.confidence >= 0.8) {
          subjectName = matchResult.subjectName;
          subjectSource = "match";
          subjectConfidence = matchResult.confidence;
        }
      }
    } catch {
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
  } else if (!autoApplySubjectMatches) {
    slateMessage = "Slate/card detection is disabled (auto-apply subject matches is off).";
  } else {
    slateMessage = "Slate/card OCR inputs were not generated from this image.";
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
        confidence: aiSuggestion.confidence,
        source: aiSuggestion.source,
      },
      previewWatermarkHeight: previewHeight,
    },
  });
}
