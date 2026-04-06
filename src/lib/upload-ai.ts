import { ParsedFilename } from "@/lib/filename-parser";
import { SUBJECT_MATCH_MIN_CONFIDENCE_DEFAULT } from "@/lib/subject-naming-constants";

type CloudSuggestionShape = {
  suggestedTitle?: string;
  suggestedEventName?: string;
  suggestedLocation?: string;
  suggestedTags?: string[];
  suggestedAttendeeKeywords?: string[];
  captionDraft?: string;
  confidence?: number;
};

export type UploadAiSuggestion = {
  capturedAt?: string;
  eventSlug?: string;
  suggestedEventName?: string;
  suggestedTitle?: string;
  suggestedLocation?: string;
  suggestedTags: string[];
  suggestedAttendeeKeywords: string[];
  captionDraft?: string;
  confidence: number;
  source: "fallback" | "openai";
};

type SuggestUploadMetadataArgs = {
  filename: string;
  parsed: ParsedFilename;
  imageDataUrl?: string;
  voiceTranscript?: string;
  metadata: {
    width?: number;
    height?: number;
    format?: string;
  };
};

function getAiTimeoutMs() {
  const parsed = Number.parseInt(process.env.AI_UPLOAD_REQUEST_TIMEOUT_MS || "", 10);
  return Number.isFinite(parsed) && parsed >= 3000 ? parsed : 20000;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = getAiTimeoutMs()) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Vision slate passes: prefer handwritten/marker on handheld board; de-prioritize typeset step-and-repeat (soft rule). */
const SYSTEM_DETECT_SUBJECT_NAME_CARD =
  "You read event photos for contributor catalog naming. The talent name is almost always HANDWRITTEN or written with dry-erase/marker on a small whiteboard, slate, or card held IN FRONT OF the subject—not typeset sponsor or venue logos on the wall behind them. Strongly prefer that handwritten/marker line; de-prioritize step-and-repeat and banner branding (clean printed fonts on the backdrop are rarely the slate). Printed stickers or pre-printed lines on the handheld board still count if they are clearly the subject identifier. Set boardVisible true only when such a foreground board/card is plausibly present. Extract the most likely PERSON NAME from that handheld source only. Return JSON only.";

const SYSTEM_RESCUE_BOARD_TEXT =
  "Transcribe text from a crop that may show the subject's handheld whiteboard, slate, or name card. Prefer HANDWRITTEN or marker text as the person's name; treat typeset backdrop and sponsor logos as noise unless that text is clearly on the handheld board itself. Then infer the most likely person name. Return JSON only.";

export type KnownSubjectReference = {
  name: string;
  referenceImageDataUrl: string;
};

/** Min model confidence to auto-apply a visual match when no slate name (default 0.8). */
export function getSubjectMatchMinConfidence(): number {
  const raw = process.env.AI_UPLOAD_SUBJECT_MATCH_MIN_CONFIDENCE?.trim() ?? "";
  const n = Number.parseFloat(raw);
  if (Number.isFinite(n) && n >= 0.5 && n <= 1) return n;
  return SUBJECT_MATCH_MIN_CONFIDENCE_DEFAULT;
}

export type SubjectDetectionResult = {
  subjectName?: string;
  confidence: number;
  source: "none" | "card" | "match";
};

function normalizeDetectedNameCandidate(value: string) {
  const cleaned = value
    .replace(/\b(name|subject|talent|guest)\s*[:\-]\s*/gi, " ")
    .replace(/[^a-zA-Z\s.'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "";
  const parts = cleaned
    .split(" ")
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 4);
  if (parts.length === 0) return "";
  return parts
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

export type VoiceTranscriptStatus =
  | "transcribed"
  | "empty"
  | "request_failed"
  | "unsupported_format"
  | "provider_disabled"
  | "missing_api_key";

export type VoiceTranscriptResult = {
  transcript?: string;
  status: VoiceTranscriptStatus;
  message: string;
};

function toTitleCase(value: string) {
  return value
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function extractSpelledNameFromTranscript(transcript: string) {
  const normalized = transcript
    .toLowerCase()
    .replace(/[-_/]/g, " ")
    .replace(/[.,!?;:()"'`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "";

  const spellingCue = /\b(spell|spelled|spelling|letters?)\b/i;
  const cueIndex = normalized.search(spellingCue);
  const searchSegment = cueIndex >= 0 ? normalized.slice(cueIndex) : normalized;
  const tokens = searchSegment.split(" ").filter(Boolean);

  const groups: string[] = [];
  let currentLetters: string[] = [];
  const flush = () => {
    if (currentLetters.length >= 2) groups.push(currentLetters.join(""));
    currentLetters = [];
  };

  for (const token of tokens) {
    if (/^[a-z]$/.test(token)) {
      currentLetters.push(token);
      continue;
    }
    if (token === "and" || token === "comma" || token === "dot" || token === "period") {
      flush();
      continue;
    }
    flush();
    if (groups.length >= 2) break;
  }
  flush();

  if (groups.length === 0) return "";
  return groups.slice(0, 2).map(toTitleCase).join(" ");
}

function extractNamedSubjectFromTranscript(transcript: string) {
  const normalized = transcript
    .toLowerCase()
    .replace(/[-_/]/g, " ")
    .replace(/[.,!?;:()"'`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "";

  const phrasePatterns = [
    /\b(?:name is|subject is|this is|it is|it's)\s+([a-z]+(?:\s+[a-z]+){0,2})\b/i,
    /\b(?:featuring|with)\s+([a-z]+(?:\s+[a-z]+){0,2})\b/i,
  ];
  for (const pattern of phrasePatterns) {
    const match = normalized.match(pattern);
    if (!match?.[1]) continue;
    const candidate = match[1]
      .split(" ")
      .filter((part) => part.length > 1)
      .slice(0, 3)
      .join(" ");
    if (!candidate) continue;
    return toTitleCase(candidate);
  }
  return "";
}

export function extractTitleFromVoiceTranscript(transcript?: string) {
  if (!transcript) return "";
  const cleaned = transcript
    .replace(/\s+/g, " ")
    .replace(/[.,!?;:]+/g, " ")
    .trim();
  if (!cleaned) return "";

  const spokenName = extractNamedSubjectFromTranscript(cleaned);
  const spelledName = extractSpelledNameFromTranscript(cleaned);
  if (spokenName && spelledName) {
    const spokenFirst = spokenName.split(" ")[0]?.toLowerCase() || "";
    const spelledFirst = spelledName.split(" ")[0]?.toLowerCase() || "";
    if (spokenFirst && spokenFirst === spelledFirst) return spelledName;
    return spokenName;
  }
  if (spokenName) return spokenName;
  if (spelledName) return spelledName;

  const words = cleaned.split(" ").filter(Boolean).slice(0, 6);
  if (words.length === 0) return "";
  return toTitleCase(words.join(" "));
}

function normalizeList(values: string[] | undefined) {
  if (!values?.length) return [];
  const cleaned = values
    .map((value) => value.trim().toLowerCase().replace(/\s+/g, "-"))
    .filter(Boolean)
    .slice(0, 14);
  return Array.from(new Set(cleaned));
}

function fallbackSuggestions({
  filename,
  parsed,
  voiceTranscript,
  metadata,
}: SuggestUploadMetadataArgs): UploadAiSuggestion {
  const normalizedBase = filename.replace(/\.[a-z0-9]+$/i, "").toLowerCase();
  const slugParts = (parsed.eventSlug || "")
    .split("-")
    .map((part) => part.trim())
    .filter(Boolean);
  const titleParts = (parsed.suggestedTitle || normalizedBase)
    .toLowerCase()
    .split(" ")
    .map((part) => part.trim())
    .filter(Boolean);
  const orientation =
    metadata.width && metadata.height
      ? metadata.width > metadata.height
        ? "landscape"
        : metadata.height > metadata.width
          ? "portrait"
          : "square"
      : undefined;
  const suggestedTags = normalizeList([
    ...slugParts,
    ...titleParts.slice(0, 4),
    orientation || "",
    metadata.format || "",
    "event-photography",
  ]);
  const suggestedAttendeeKeywords = normalizeList([
    parsed.eventSlug || "",
    "group-photo",
    "event-highlights",
  ]);
  const captionDraft = parsed.suggestedEventName
    ? `${parsed.suggestedTitle || "Event moment"} at ${parsed.suggestedEventName}.`
    : `${parsed.suggestedTitle || "Event moment"} from live coverage.`;

  const voiceTitle = extractTitleFromVoiceTranscript(voiceTranscript);
  return {
    capturedAt: parsed.capturedAt,
    eventSlug: parsed.eventSlug,
    suggestedEventName: parsed.suggestedEventName,
    suggestedTitle: voiceTitle || parsed.suggestedTitle,
    suggestedLocation: "",
    suggestedTags,
    suggestedAttendeeKeywords,
    captionDraft,
    confidence: voiceTitle ? 0.58 : 0.46,
    source: "fallback",
  };
}

async function tryOpenAiSuggestions({
  filename,
  parsed,
  imageDataUrl,
  voiceTranscript,
  metadata,
}: SuggestUploadMetadataArgs): Promise<UploadAiSuggestion | null> {
  if ((process.env.AI_UPLOAD_PROVIDER || "").toLowerCase() !== "openai") return null;
  const apiKey = process.env.OPENAI_API_KEY || "";
  if (!apiKey) return null;
  const model = process.env.AI_UPLOAD_MODEL || "gpt-4.1-mini";

  const userText = [
    `Filename: ${filename}`,
    `Parsed event slug: ${parsed.eventSlug || "(unknown)"}`,
    `Parsed event name: ${parsed.suggestedEventName || "(unknown)"}`,
    `Parsed subject title: ${parsed.suggestedTitle || "(unknown)"}`,
    `Voice transcript (if any): ${voiceTranscript || "(none)"}`,
    `Image metadata: width=${String(metadata.width || 0)} height=${String(metadata.height || 0)} format=${metadata.format || "(unknown)"}`,
    "Generate metadata that helps photographers submit quickly. If transcript contains a person name, prioritize that as suggestedTitle.",
    "If the transcript spells the name letter-by-letter, reconstruct the proper name and prioritize that.",
  ].join("\n");

  const inputContent: Array<{ type: "input_text" | "input_image"; text?: string; image_url?: string }> = [
    { type: "input_text", text: userText },
  ];
  if (imageDataUrl) inputContent.push({ type: "input_image", image_url: imageDataUrl });

  const response = await fetchWithTimeout("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: "You are a newsroom photo ingest assistant. Return concise JSON only.",
            },
          ],
        },
        { role: "user", content: inputContent },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "upload_suggestion",
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              suggestedTitle: { type: "string" },
              suggestedEventName: { type: "string" },
              suggestedLocation: { type: "string" },
              suggestedTags: { type: "array", items: { type: "string" } },
              suggestedAttendeeKeywords: { type: "array", items: { type: "string" } },
              captionDraft: { type: "string" },
              confidence: { type: "number", minimum: 0, maximum: 1 },
            },
            required: [
              "suggestedTitle",
              "suggestedEventName",
              "suggestedLocation",
              "suggestedTags",
              "suggestedAttendeeKeywords",
              "captionDraft",
              "confidence",
            ],
          },
          strict: true,
        },
      },
    }),
  });
  if (!response.ok) return null;

  const data = (await response.json()) as { output_text?: string };
  if (!data.output_text) return null;

  const parsedCloud = JSON.parse(data.output_text) as CloudSuggestionShape;
  return {
    capturedAt: parsed.capturedAt,
    eventSlug: parsed.eventSlug,
    suggestedEventName: parsedCloud.suggestedEventName || parsed.suggestedEventName,
    suggestedTitle: parsedCloud.suggestedTitle || parsed.suggestedTitle,
    suggestedLocation: parsedCloud.suggestedLocation || "",
    suggestedTags: normalizeList(parsedCloud.suggestedTags),
    suggestedAttendeeKeywords: normalizeList(parsedCloud.suggestedAttendeeKeywords),
    captionDraft: parsedCloud.captionDraft || "",
    confidence: Math.max(0, Math.min(1, parsedCloud.confidence ?? 0.64)),
    source: "openai",
  };
}

export async function transcribeVoiceNoteDetailed(voiceFile: File): Promise<VoiceTranscriptResult> {
  const apiKey = process.env.OPENAI_API_KEY || "";
  if ((process.env.AI_UPLOAD_PROVIDER || "").toLowerCase() !== "openai") {
    return {
      status: "provider_disabled",
      message: "AI provider is not set to OpenAI for transcription.",
    };
  }
  if (!apiKey) {
    return {
      status: "missing_api_key",
      message: "OPENAI_API_KEY is missing; WAV transcription skipped.",
    };
  }

  const filename = (voiceFile.name || "").toLowerCase();
  const isWave = filename.endsWith(".wav") || filename.endsWith(".wave");
  if (!isWave) {
    return {
      status: "unsupported_format",
      message: "Voice note is not a WAV file.",
    };
  }

  const model = process.env.AI_UPLOAD_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe";
  const payload = new FormData();
  payload.append("model", model);
  payload.append("file", voiceFile, voiceFile.name || "voice-note.wav");

  const response = await fetchWithTimeout("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: payload,
  });
  if (!response.ok) {
    return {
      status: "request_failed",
      message: `OpenAI transcription request failed (${response.status}).`,
    };
  }
  const data = (await response.json()) as { text?: string };
  const transcript = data.text?.trim();
  if (!transcript) {
    return {
      status: "empty",
      message: "Transcription completed but no speech text was detected.",
    };
  }
  return {
    transcript,
    status: "transcribed",
    message: "Voice note transcribed successfully.",
  };
}

export async function transcribeVoiceNote(voiceFile: File): Promise<string | undefined> {
  const result = await transcribeVoiceNoteDetailed(voiceFile);
  return result.transcript;
}

export async function detectSubjectNameFromCard(args: {
  filename: string;
  imageDataUrl?: string;
  modelOverride?: string;
}): Promise<SubjectDetectionResult> {
  if (!args.imageDataUrl) return { confidence: 0, source: "none" };
  if ((process.env.AI_UPLOAD_PROVIDER || "").toLowerCase() !== "openai") {
    return { confidence: 0, source: "none" };
  }
  const apiKey = process.env.OPENAI_API_KEY || "";
  if (!apiKey) return { confidence: 0, source: "none" };
  const model = args.modelOverride || process.env.AI_UPLOAD_MODEL || "gpt-4.1-mini";

  const response = await fetchWithTimeout("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: SYSTEM_DETECT_SUBJECT_NAME_CARD,
            },
          ],
        },
        {
          role: "user",
          content: [
            { type: "input_text", text: `Filename: ${args.filename}` },
            { type: "input_image", image_url: args.imageDataUrl },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "subject_name_card",
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              boardVisible: { type: "boolean" },
              rawBoardText: { type: "string" },
              candidatePersonName: { type: "string" },
              confidence: { type: "number", minimum: 0, maximum: 1 },
            },
            required: ["boardVisible", "rawBoardText", "candidatePersonName", "confidence"],
          },
          strict: true,
        },
      },
    }),
  });
  if (!response.ok) return { confidence: 0, source: "none" };
  const data = (await response.json()) as { output_text?: string };
  if (!data.output_text) return { confidence: 0, source: "none" };
  const parsed = JSON.parse(data.output_text) as {
    boardVisible: boolean;
    rawBoardText: string;
    candidatePersonName: string;
    confidence: number;
  };
  const name = normalizeDetectedNameCandidate(
    parsed.candidatePersonName || parsed.rawBoardText || "",
  );
  if (!parsed.boardVisible && !name) return { confidence: 0, source: "none" };
  return {
    subjectName: name || undefined,
    confidence: Math.max(0, Math.min(1, parsed.confidence || 0)),
    source: "card",
  };
}

export async function rescueBoardNameFromText(args: {
  filename: string;
  imageDataUrl?: string;
  modelOverride?: string;
}): Promise<{ candidateName?: string; rawBoardText?: string; confidence: number }> {
  if (!args.imageDataUrl) return { confidence: 0 };
  if ((process.env.AI_UPLOAD_PROVIDER || "").toLowerCase() !== "openai") return { confidence: 0 };
  const apiKey = process.env.OPENAI_API_KEY || "";
  if (!apiKey) return { confidence: 0 };
  const model = args.modelOverride || process.env.AI_UPLOAD_MODEL || "gpt-4.1-mini";

  const response = await fetchWithTimeout("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: SYSTEM_RESCUE_BOARD_TEXT,
            },
          ],
        },
        {
          role: "user",
          content: [
            { type: "input_text", text: `Filename: ${args.filename}` },
            { type: "input_image", image_url: args.imageDataUrl },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "board_text_rescue",
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              rawBoardText: { type: "string" },
              candidatePersonName: { type: "string" },
              confidence: { type: "number", minimum: 0, maximum: 1 },
            },
            required: ["rawBoardText", "candidatePersonName", "confidence"],
          },
          strict: true,
        },
      },
    }),
  });
  if (!response.ok) return { confidence: 0 };
  const data = (await response.json()) as { output_text?: string };
  if (!data.output_text) return { confidence: 0 };
  const parsed = JSON.parse(data.output_text) as {
    rawBoardText: string;
    candidatePersonName: string;
    confidence: number;
  };
  const candidateName = normalizeDetectedNameCandidate(
    parsed.candidatePersonName || parsed.rawBoardText || "",
  );
  return {
    candidateName: candidateName || undefined,
    rawBoardText: (parsed.rawBoardText || "").trim() || undefined,
    confidence: Math.max(0, Math.min(1, parsed.confidence || 0)),
  };
}

export async function matchSubjectAgainstKnown(args: {
  imageDataUrl?: string;
  /** Optional tighter upper-body crop of the same frame (reduces step-and-repeat noise). */
  portraitCropDataUrl?: string;
  knownSubjects: KnownSubjectReference[];
}): Promise<SubjectDetectionResult> {
  if (!args.imageDataUrl || args.knownSubjects.length === 0) return { confidence: 0, source: "none" };
  if ((process.env.AI_UPLOAD_PROVIDER || "").toLowerCase() !== "openai") {
    return { confidence: 0, source: "none" };
  }
  const apiKey = process.env.OPENAI_API_KEY || "";
  if (!apiKey) return { confidence: 0, source: "none" };
  const model = process.env.AI_UPLOAD_MODEL || "gpt-4.1-mini";
  const candidates = args.knownSubjects.slice(0, 8);

  const portraitCropUrl = args.portraitCropDataUrl?.trim() || "";
  const hasPortraitCrop = portraitCropUrl.length > 0;
  const intro = hasPortraitCrop
    ? "The first image is the full new event photo; the second is a tighter crop of the same shot (face and upper body). Both show the same candidate. Ignore step-and-repeat logos and backdrop text—they are not the person's name. The following pairs are (name, reference photo) for people already identified from earlier images (usually from a slate). Decide if the candidate is the same person as exactly one reference, by face, hair, glasses, skin tone, build, outfit, and pose. If none match clearly, return none."
    : "The first image is a new event photo; the main subject is usually the person in the foreground. Ignore step-and-repeat logos and backdrop text—they are not the person's name. The following pairs are (name, reference photo) for people already identified from earlier images (usually from a slate). Decide if the new photo shows the same person as exactly one reference, by face, hair, glasses, skin tone, build, outfit, and pose. If none match clearly, return none.";

  const content: Array<{ type: "input_text" | "input_image"; text?: string; image_url?: string }> = [
    { type: "input_text", text: intro },
    { type: "input_text", text: "New photo (candidate, full frame):" },
    { type: "input_image", image_url: args.imageDataUrl },
  ];
  if (hasPortraitCrop) {
    content.push({ type: "input_text", text: "Same candidate (portrait crop):" });
    content.push({ type: "input_image", image_url: portraitCropUrl });
  }
  for (const subject of candidates) {
    content.push({ type: "input_text", text: `Reference — ${subject.name}:` });
    content.push({ type: "input_image", image_url: subject.referenceImageDataUrl });
  }

  const response = await fetchWithTimeout("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: "You re-identify event attendees across photos. Reference images were labeled with a name (often from a slate in that shot). The candidate may be a different pose, crop, or angle, may include glasses, and may have no slate—compare the foreground person only; ignore backdrop branding. Match only if it is clearly the same individual. If unsure or it could be a different person, return matchedName \"none\" and confidence 0. Return JSON only.",
            },
          ],
        },
        { role: "user", content },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "subject_match",
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              matchedName: { type: "string" },
              confidence: { type: "number", minimum: 0, maximum: 1 },
            },
            required: ["matchedName", "confidence"],
          },
          strict: true,
        },
      },
    }),
  });
  if (!response.ok) return { confidence: 0, source: "none" };
  const data = (await response.json()) as { output_text?: string };
  if (!data.output_text) return { confidence: 0, source: "none" };
  const parsed = JSON.parse(data.output_text) as { matchedName: string; confidence: number };
  const matchedRaw = parsed.matchedName.trim();
  if (!matchedRaw || matchedRaw.toLowerCase() === "none") return { confidence: 0, source: "none" };
  const matchNorm = matchedRaw.toLowerCase();
  const exact = candidates.find((c) => c.name.toLowerCase() === matchNorm);
  const chosen =
    exact ||
    candidates.find(
      (c) => matchNorm.includes(c.name.toLowerCase()) || c.name.toLowerCase().includes(matchNorm),
    );
  if (!chosen) return { confidence: 0, source: "none" };
  return {
    subjectName: chosen.name,
    confidence: Math.max(0, Math.min(1, parsed.confidence || 0)),
    source: "match",
  };
}

export async function suggestUploadMetadata(
  args: SuggestUploadMetadataArgs,
): Promise<UploadAiSuggestion> {
  const fallback = fallbackSuggestions(args);
  try {
    const cloud = await tryOpenAiSuggestions(args);
    if (!cloud) return fallback;
    return cloud;
  } catch {
    return fallback;
  }
}
