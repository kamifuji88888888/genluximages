/**
 * Shared slate/board OCR helpers: preprocess images, extract a candidate name from raw OCR text,
 * and run OCR on an image buffer (Google Cloud Vision only; no Tesseract on server).
 * OpenAI slate passes in upload-ai state a handwriting/marker-on-handheld-board preference; Vision
 * here is raw OCR—ranking and backdrop penalties in this file still apply.
 * Word bounding boxes (when present) bias toward compact foreground clusters vs step-and-repeat.
 */
import sharp from "sharp";
import {
  isGoogleVisionConfigured,
  runGoogleVisionOcr,
  type VisionWordBox,
} from "@/lib/google-vision-ocr";

const LABEL_PREFIX =
  /^\s*(name|subject|talent|guest|attendee|person|title|role)\s*[:\-–—]\s*/i;

/** Upscale small crops, normalize contrast — tuned for dry-erase / cardstock slates. */
export async function prepareImageBufferForSlateOcr(buffer: Buffer): Promise<Buffer> {
  const meta = await sharp(buffer).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (w < 2 || h < 2) return buffer;

  const minDim = Math.min(w, h);
  let pipeline = sharp(buffer);

  if (minDim < 640) {
    pipeline = pipeline.resize({
      width: 1400,
      height: 1400,
      fit: "inside",
      withoutEnlargement: false,
    });
  }

  return pipeline
    .normalise()
    .modulate({ brightness: 1.07, saturation: 0.86 })
    .sharpen({ sigma: 1.12, m1: 1, m2: 2, x1: 2, y2: 10, y3: 20 })
    .png()
    .toBuffer();
}

function normalizeSlateLine(line: string): string {
  let s = line.replace(LABEL_PREFIX, "").trim();
  // "Smith, Jane" / "SMITH, JANE Q" → read as first-name ordering for scoring
  const comma = /^\s*([A-Za-z][A-Za-z'-]{1,})\s*,\s*([A-Za-z][A-Za-z'-]*(?:\s+[A-Za-z][A-Za-z'-]*)*)\s*$/;
  const m = s.match(comma);
  if (m) {
    s = `${m[2]} ${m[1]}`.replace(/\s+/g, " ").trim();
  }
  return s;
}

const TOKEN = /^[a-zA-Z][a-zA-Z'-]{1,}$/;

/** Field labels only when they stand alone as the first token (not surnames like "Guest"). */
const LEADING_LABEL_WORDS = new Set([
  "name",
  "subject",
  "talent",
  "guest",
  "board",
  "slate",
  "shot",
  "list",
  "scene",
  "take",
  "camera",
  "roll",
  "production",
  "project",
  "date",
  "time",
]);

const STOP_WORDS = new Set([
  "name",
  "subject",
  "talent",
  "board",
  "slate",
  "shot",
  "list",
  "scene",
  "take",
  "camera",
  "roll",
  "production",
  "project",
  "date",
  "time",
]);

/**
 * Vision often emits a spurious 2-letter "word" before a surname: e.g. "On Phiro" from
 * a partial "John"/"Name" read, marker bleed, or line break. Strip only when the
 * remainder looks like a real name token (avoid eating "An Nguyen"-style names).
 */
/** Require a long second token so we do not eat real short names (e.g. An Pham, Ed Lee). */
const TWO_LETTER_OCR_LEADING_JUNK = new Set([
  "on", // very common fragment (John / Name / marker noise)
  "no",
  "oh",
  "or",
  "of",
  "to",
]);

const THREE_LETTER_OCR_LEADING_JUNK = new Set(["the", "and", "but", "for"]);

function stripLeadingOcrNoiseTokens(parts: string[]): string[] {
  if (parts.length < 2) return parts;
  const out = [...parts];
  while (out.length >= 2) {
    const first = out[0];
    const second = out[1];
    const fl = first.toLowerCase();
    if (first.length <= 2 && TWO_LETTER_OCR_LEADING_JUNK.has(fl) && second.length >= 5) {
      out.shift();
      continue;
    }
    if (first.length === 3 && THREE_LETTER_OCR_LEADING_JUNK.has(fl) && second.length >= 4) {
      out.shift();
      continue;
    }
    break;
  }
  return out;
}

function scoreNameParts(parts: string[], candidate: string): number {
  const lowered = parts.map((p) => p.toLowerCase());
  if (parts.length < 1) return -1;

  if (lowered[0] && LEADING_LABEL_WORDS.has(lowered[0])) return -1;
  if (lowered.every((p) => STOP_WORDS.has(p))) return -1;
  if (parts.some((part) => part.length > 22)) return -1;

  let score = 0;
  if (parts.length === 2) score += 5;
  else if (parts.length === 3) score += 4;
  else if (parts.length === 1) score += 2;
  else score += 1;

  score += lowered.every((part) => part.length >= 3) ? 2 : 0;
  score += /^[A-Z][a-z]/.test(parts[0] || "") ? 1 : 0;
  score += /^[A-Z][a-z]/.test(parts[1] || "") ? 1 : 0;
  score -= /[A-Z]{4,}/.test(candidate) ? 2 : 0;
  return score;
}

function formatNameParts(parts: string[]): string {
  return parts
    .slice(0, 3)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

/** Step-and-repeat / sponsor wall text bundled into full-frame Vision reads. */
const BACKDROP_OCR_KEYWORDS = [
  "philanthropy",
  "genlux",
  "louis",
  "vuitton",
  "fashion",
  "collection",
  "wish list",
  "restaurant",
  "lounge",
  "magazine",
  "sponsor",
  "presented by",
  "issue",
  "ritual",
  "zero proof",
  "step and",
  "red carpet",
  "adre",
  "qr code",
];

export function backdropOcrNoiseHits(raw: string): number {
  const r = raw.toLowerCase();
  let n = 0;
  for (const k of BACKDROP_OCR_KEYWORDS) {
    if (r.includes(k)) n += 1;
  }
  return n;
}

/**
 * Names that are almost certainly mis-reads of sponsor lines (e.g. ON+PHILANTHROPY → "On Phiro").
 */
function isLikelySponsorNameArtifact(name: string, raw: string): boolean {
  const rl = raw.toLowerCase();
  const compact = name.toLowerCase().replace(/\s+/g, "");
  const nl = name.toLowerCase();
  if (rl.includes("philanthropy")) {
    if (/phiro|philan|nthropy|onphi/i.test(compact)) return true;
    if (compact === "on" || /^on[a-z]{3,}$/i.test(compact)) return true;
  }
  // Step-and-repeat brand fragment "Adre by …" → OCR often yields "Adre By"
  if (/\badre\b/i.test(rl) && nl.includes("adre") && /\bby\b/.test(nl)) return true;
  return false;
}

function isFullFrameSlatePass(pass: string): boolean {
  const p = pass.toLowerCase();
  return p === "full_frame" || p === "whiteboard_enhanced_full";
}

export function pickNameFromOcrTextWithScore(raw: string): { name: string; score: number } {
  const cleaned = raw
    .replace(/[|\\/_~`]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return { name: "", score: 0 };

  const lines = raw
    .split(/\r?\n/)
    .map((line) => normalizeSlateLine(line))
    .map((line) => line.replace(/[^a-zA-Z\s,'-]/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const candidates: string[] = [...lines, cleaned];

  let best: { name: string; score: number } = { name: "", score: 0 };

  for (const candidate of candidates) {
    let parts = candidate
      .split(" ")
      .map((part) => part.trim().replace(/^'+|'+$/g, ""))
      .filter((part) => TOKEN.test(part))
      .slice(0, 4);

    parts = stripLeadingOcrNoiseTokens(parts);

    if (parts.length === 0) continue;
    if (parts.length === 1 && (parts[0].length < 4 || parts[0].length > 18)) continue;

    const score = scoreNameParts(parts, candidate);
    if (score < 0) continue;

    const formatted = formatNameParts(parts);
    if (isLikelySponsorNameArtifact(formatted, raw)) continue;

    if (score > best.score) {
      best = { name: formatted, score };
    }
  }

  return best;
}

export function pickNameFromOcrText(raw: string): string {
  return pickNameFromOcrTextWithScore(raw).name;
}

/**
 * Prefer text in the handheld-slate band (mid/lower center) over upper step-and-repeat logos.
 * Returns a bonus roughly in [-4, +5].
 */
export function foregroundSlateLocationBonus(cx: number, cy: number): number {
  let score = 0;
  // Torso / hands zone for held boards
  if (cy >= 0.32 && cy <= 0.88) score += 3;
  else if (cy >= 0.22 && cy < 0.32) score += 1;
  else if (cy < 0.18) score -= 3.5; // typical logo strip
  else score -= 1;

  if (cx >= 0.18 && cx <= 0.82) score += 1.5;
  else if (cx < 0.08 || cx > 0.92) score -= 1.5;
  return score;
}

/**
 * Build a person-name candidate from Vision word boxes, preferring compact foreground clusters.
 */
export function pickNameFromVisionWords(
  words: VisionWordBox[],
  fallbackRawText: string,
): { name: string; score: number; boxBonus: number } {
  const tokenWords = words
    .map((w) => ({
      ...w,
      clean: w.text.replace(/[^a-zA-Z'-]/g, "").trim(),
    }))
    .filter((w) => TOKEN.test(w.clean) && w.clean.length >= 2 && w.clean.length <= 22);

  if (tokenWords.length === 0) {
    const fallback = pickNameFromOcrTextWithScore(fallbackRawText);
    return { ...fallback, boxBonus: 0 };
  }

  // Group into approximate lines by vertical proximity
  const sorted = [...tokenWords].sort((a, b) => a.cy - b.cy || a.cx - b.cx);
  const lines: typeof tokenWords[] = [];
  for (const word of sorted) {
    const line = lines.find((group) => Math.abs(group[0].cy - word.cy) < 0.045);
    if (line) line.push(word);
    else lines.push([word]);
  }

  let best: { name: string; score: number; boxBonus: number } = {
    name: "",
    score: 0,
    boxBonus: 0,
  };

  for (const line of lines) {
    const ordered = [...line].sort((a, b) => a.cx - b.cx);
    for (let i = 0; i < ordered.length; i += 1) {
      for (let len = 1; len <= 3 && i + len <= ordered.length; len += 1) {
        const slice = ordered.slice(i, i + len);
        let parts = slice.map((w) => w.clean);
        parts = stripLeadingOcrNoiseTokens(parts);
        if (parts.length === 0) continue;
        if (parts.length === 1 && (parts[0].length < 4 || parts[0].length > 18)) continue;

        const nameScore = scoreNameParts(parts, parts.join(" "));
        if (nameScore < 0) continue;

        const cx =
          slice.reduce((sum, w) => sum + w.cx, 0) / Math.max(1, slice.length);
        const cy =
          slice.reduce((sum, w) => sum + w.cy, 0) / Math.max(1, slice.length);
        const spanX = Math.max(...slice.map((w) => w.cx)) - Math.min(...slice.map((w) => w.cx));
        // Compact clusters (handheld board) beat wide logo strips
        const compactBonus = spanX < 0.35 ? 2 : spanX < 0.55 ? 0.5 : -2.5;
        const locBonus = foregroundSlateLocationBonus(cx, cy);
        const confBonus =
          slice.reduce((sum, w) => sum + (w.confidence || 0), 0) / slice.length;
        const boxBonus = locBonus + compactBonus + confBonus;
        const total = nameScore + boxBonus;
        const formatted = formatNameParts(parts);
        if (isLikelySponsorNameArtifact(formatted, fallbackRawText)) continue;
        if (total > best.score) {
          best = { name: formatted, score: total, boxBonus };
        }
      }
    }
  }

  if (!best.name) {
    const fallback = pickNameFromOcrTextWithScore(fallbackRawText);
    return { ...fallback, boxBonus: 0 };
  }
  return best;
}

/**
 * Subject-held slates sit in the lower-mid frame (torso/hands); step-and-repeat fills the upper field.
 * Bias OCR fusion toward foreground-targeted passes and away from whole-frame reads.
 */
export function slatePassForegroundDepthBonus(pass: string): number {
  const p = pass.toLowerCase();
  if (p === "full_frame") return -3;
  if (p === "whiteboard_enhanced_full") return -1.5;
  if (p.includes("foreground_slate")) return 4;
  if (p.includes("board_candidate")) return 0.5;
  if (p.startsWith("focused_") || p.startsWith("whiteboard_enhanced_")) return 2;
  return 0;
}

export function chooseBestGoogleSlateOcrEntry<
  T extends {
    pass: string;
    candidateName: string;
    rawText: string;
    boxBonus?: number;
  },
>(entries: T[], passPreferenceOrder: string[]): T | null {
  let withNames = entries.filter((e) => e.candidateName.trim());
  if (withNames.length === 0) return null;

  // Whole-frame reads almost always mix step-and-repeat text with the handheld slate.
  // If we see any backdrop keyword, do not let full_frame / enhanced_full win when a crop
  // also produced a name; if only full_frame matched, discard it and fall through to OpenAI crops.
  const withoutNoisyWholeFrame = withNames.filter(
    (e) => !(isFullFrameSlatePass(e.pass) && backdropOcrNoiseHits(e.rawText) >= 1),
  );
  if (withoutNoisyWholeFrame.length > 0) {
    withNames = withoutNoisyWholeFrame;
  } else {
    const onlyWhole = withNames.every((e) => isFullFrameSlatePass(e.pass));
    if (onlyWhole && withNames.some((e) => backdropOcrNoiseHits(e.rawText) >= 1)) {
      return null;
    }
  }

  const orderIdx = (p: string) => {
    const i = passPreferenceOrder.indexOf(p);
    return i === -1 ? 999 : i;
  };

  const effective = (raw: string, parseScore: number, pass: string, boxBonus = 0) =>
    parseScore -
    Math.min(12, backdropOcrNoiseHits(raw)) * 1.25 +
    slatePassForegroundDepthBonus(pass) +
    boxBonus * 0.35;

  return [...withNames].sort((a, b) => {
    const sa = pickNameFromOcrTextWithScore(a.rawText);
    const sb = pickNameFromOcrTextWithScore(b.rawText);
    const ea = effective(a.rawText, sa.score, a.pass, a.boxBonus || 0);
    const eb = effective(b.rawText, sb.score, b.pass, b.boxBonus || 0);
    if (eb !== ea) return eb - ea;
    const na = backdropOcrNoiseHits(a.rawText);
    const nb = backdropOcrNoiseHits(b.rawText);
    if (na !== nb) return na - nb;
    if (orderIdx(a.pass) !== orderIdx(b.pass)) return orderIdx(a.pass) - orderIdx(b.pass);
    const la = a.rawText.trim().length;
    const lb = b.rawText.trim().length;
    if (la !== lb) return la - lb;
    return 0;
  })[0];
}

export async function runOcrOnImageBuffer(
  imageBuffer: Buffer,
): Promise<{
  candidateName: string;
  rawText: string;
  provider?: "google" | "tesseract";
  boxBonus?: number;
  words?: VisionWordBox[];
}> {
  if (!isGoogleVisionConfigured()) {
    return { candidateName: "", rawText: "" };
  }
  try {
    const prepared = await prepareImageBufferForSlateOcr(imageBuffer);
    const { rawText, words } = await runGoogleVisionOcr(prepared);
    const fromBoxes = pickNameFromVisionWords(words, rawText);
    const fromText = pickNameFromOcrTextWithScore(rawText);
    // Prefer box-aware pick when it found a name; otherwise fall back to line OCR.
    const chosen =
      fromBoxes.name && fromBoxes.score >= fromText.score
        ? fromBoxes
        : { name: fromText.name, score: fromText.score, boxBonus: fromBoxes.boxBonus || 0 };
    return {
      candidateName: chosen.name,
      rawText,
      provider: "google",
      boxBonus: chosen.boxBonus,
      words,
    };
  } catch (e) {
    console.error("Google Vision OCR failed:", e);
    return { candidateName: "", rawText: "" };
  }
}
