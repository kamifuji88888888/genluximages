import { ParsedFilename } from "@/lib/filename-parser";

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

export type KnownSubjectReference = {
  name: string;
  referenceImageDataUrl: string;
};

export type SubjectDetectionResult = {
  subjectName?: string;
  confidence: number;
  source: "none" | "card" | "match";
};

function titleFromVoiceTranscript(transcript?: string) {
  if (!transcript) return "";
  const cleaned = transcript
    .replace(/\s+/g, " ")
    .replace(/[.,!?;:]+/g, " ")
    .trim();
  if (!cleaned) return "";

  const words = cleaned.split(" ").filter(Boolean).slice(0, 6);
  if (words.length === 0) return "";
  return words
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
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

  const voiceTitle = titleFromVoiceTranscript(voiceTranscript);
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

export async function transcribeVoiceNote(voiceFile: File): Promise<string | undefined> {
  if ((process.env.AI_UPLOAD_PROVIDER || "").toLowerCase() !== "openai") return undefined;
  const apiKey = process.env.OPENAI_API_KEY || "";
  if (!apiKey) return undefined;

  const filename = (voiceFile.name || "").toLowerCase();
  const isWave = filename.endsWith(".wav") || filename.endsWith(".wave");
  if (!isWave) return undefined;

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
  if (!response.ok) return undefined;
  const data = (await response.json()) as { text?: string };
  const transcript = data.text?.trim();
  return transcript || undefined;
}

export async function detectSubjectNameFromCard(args: {
  filename: string;
  imageDataUrl?: string;
}): Promise<SubjectDetectionResult> {
  if (!args.imageDataUrl) return { confidence: 0, source: "none" };
  if ((process.env.AI_UPLOAD_PROVIDER || "").toLowerCase() !== "openai") {
    return { confidence: 0, source: "none" };
  }
  const apiKey = process.env.OPENAI_API_KEY || "";
  if (!apiKey) return { confidence: 0, source: "none" };
  const model = process.env.AI_UPLOAD_MODEL || "gpt-4.1-mini";

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
              text: "Detect if this image contains a handwritten or printed name card. Return JSON only.",
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
              hasNameCard: { type: "boolean" },
              detectedName: { type: "string" },
              confidence: { type: "number", minimum: 0, maximum: 1 },
            },
            required: ["hasNameCard", "detectedName", "confidence"],
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
    hasNameCard: boolean;
    detectedName: string;
    confidence: number;
  };
  const name = parsed.detectedName.trim();
  if (!parsed.hasNameCard || !name) return { confidence: 0, source: "none" };
  return {
    subjectName: name,
    confidence: Math.max(0, Math.min(1, parsed.confidence || 0)),
    source: "card",
  };
}

export async function matchSubjectAgainstKnown(args: {
  imageDataUrl?: string;
  knownSubjects: KnownSubjectReference[];
}): Promise<SubjectDetectionResult> {
  if (!args.imageDataUrl || args.knownSubjects.length === 0) return { confidence: 0, source: "none" };
  if ((process.env.AI_UPLOAD_PROVIDER || "").toLowerCase() !== "openai") {
    return { confidence: 0, source: "none" };
  }
  const apiKey = process.env.OPENAI_API_KEY || "";
  if (!apiKey) return { confidence: 0, source: "none" };
  const model = process.env.AI_UPLOAD_MODEL || "gpt-4.1-mini";
  const candidates = args.knownSubjects.slice(0, 5);

  const content: Array<{ type: "input_text" | "input_image"; text?: string; image_url?: string }> = [
    {
      type: "input_text",
      text: "Given a candidate event photo and reference subjects, choose the best subject match or none.",
    },
    { type: "input_text", text: "Candidate image:" },
    { type: "input_image", image_url: args.imageDataUrl },
  ];
  for (const subject of candidates) {
    content.push({ type: "input_text", text: `Reference subject: ${subject.name}` });
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
              text: "Match subjects conservatively. If uncertain, return no match. Return JSON only.",
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
  const matched = parsed.matchedName.trim();
  if (!matched || matched.toLowerCase() === "none") return { confidence: 0, source: "none" };
  return {
    subjectName: matched,
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
