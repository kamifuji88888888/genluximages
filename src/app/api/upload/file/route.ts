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
  matchSubjectAgainstKnown,
  suggestUploadMetadata,
  transcribeVoiceNote,
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

  const metadata = await sharp(inputBytes).metadata();
  const resizedPreview = await sharp(inputBytes)
    .resize({
      width: 1400,
      height: 1400,
      fit: "inside",
      withoutEnlargement: true,
    })
    .toBuffer();
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
  let aiImageDataUrl: string | undefined;
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
  } catch {
    aiImageDataUrl = undefined;
  }
  let voiceTranscript: string | undefined;
  if (voiceNote instanceof File && voiceNote.size > 0) {
    try {
      voiceTranscript = await transcribeVoiceNote(voiceNote);
    } catch {
      voiceTranscript = undefined;
    }
  }
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
  if (autoApplySubjectMatches && aiImageDataUrl) {
    try {
      const cardResult = await detectSubjectNameFromCard({
        filename: originalName,
        imageDataUrl: aiImageDataUrl,
      });
      if (cardResult.subjectName && cardResult.confidence >= 0.72) {
        subjectName = cardResult.subjectName;
        subjectSource = "card";
        subjectConfidence = cardResult.confidence;
        upsertKnownSubjectForEvent({
          uploaderEmail: session.email,
          eventSlug: eventSlugForSubjects,
          name: subjectName,
          referenceImageDataUrl: aiImageDataUrl,
        });
      } else {
        const knownSubjects = getKnownSubjectsForEvent({
          uploaderEmail: session.email,
          eventSlug: eventSlugForSubjects,
        });
        const matchResult = await matchSubjectAgainstKnown({
          imageDataUrl: aiImageDataUrl,
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
    }
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
        voiceTranscript: voiceTranscript || "",
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
