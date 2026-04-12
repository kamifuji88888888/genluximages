"use client";

import Link from "next/link";
import Image from "next/image";
import { DragEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  getMediaKindFromExtension,
  suggestMediaFilename,
  validateMediaFilename,
} from "@/lib/media-filename";
import { sanitizeDiagnosticCandidateName } from "@/lib/slate-ocr-text";
type UploadResponse = {
  ok: boolean;
  message: string;
};

type SlateDetectionPass = string;

type UploadAutomationResponse = {
  ok: boolean;
  message: string;
  suggestion?: string;
  data?: {
    filename: string;
    previewUrl: string;
    fullResUrl: string;
    storageKey: string;
    suggestions: {
      capturedAt?: string;
      eventSlug?: string;
      suggestedEventName?: string;
      suggestedTitle?: string;
      suggestedLocation?: string;
      suggestedTags?: string[];
      suggestedAttendeeKeywords?: string[];
      captionDraft?: string;
      voiceTranscript?: string;
      voiceNoteMatched?: boolean;
      voiceTranscriptStatus?:
        | "not_provided"
        | "transcribed"
        | "empty"
        | "request_failed"
        | "unsupported_format"
        | "provider_disabled"
        | "missing_api_key";
      voiceTranscriptMessage?: string;
      voiceTitleCandidate?: string;
      voiceTitleApplied?: boolean;
      slateDetected?: boolean;
      slateCandidateName?: string;
      slateConfidence?: number;
      slateApplied?: boolean;
      slateDetectionPass?: SlateDetectionPass;
      slateModelUsed?: string;
      slateFallbackAttempted?: boolean;
      slateMessage?: string;
      slatePasses?: Array<{
        pass: Exclude<SlateDetectionPass, "none">;
        model: string;
        detected: boolean;
        candidateName: string;
        confidence: number;
      }>;
      subjectName?: string;
      subjectSource?: "none" | "card" | "match";
      subjectConfidence?: number;
      subjectNamingStatus?: "from_slate" | "from_match" | "needs_manual" | null;
      confidence?: number;
      source?: "fallback" | "openai";
    };
  };
};

type LatestAiSuggestion = {
  title: string;
  eventName: string;
  eventSlug: string;
  capturedAt: string;
  location: string;
  tags: string;
  attendeeKeywords: string;
  captionDraft: string;
  voiceTranscript: string;
  voiceNoteMatched: boolean;
  voiceTranscriptStatus:
    | "not_provided"
    | "transcribed"
    | "empty"
    | "request_failed"
    | "unsupported_format"
    | "provider_disabled"
    | "missing_api_key";
  voiceTranscriptMessage: string;
  voiceTitleCandidate: string;
  voiceTitleApplied: boolean;
  slateDetected: boolean;
  slateCandidateName: string;
  slateConfidence: number;
  slateApplied: boolean;
  slateDetectionPass: SlateDetectionPass;
  slateModelUsed: string;
  slateFallbackAttempted: boolean;
  slateMessage: string;
  slatePasses: Array<{
    pass: Exclude<SlateDetectionPass, "none">;
    model: string;
    detected: boolean;
    candidateName: string;
    confidence: number;
  }>;
  subjectName: string;
  subjectSource: "none" | "card" | "match";
  subjectConfidence: number;
  subjectNamingStatus: "from_slate" | "from_match" | "needs_manual" | null;
  confidence: number;
  source: "fallback" | "openai";
};

type UploadFormValues = {
  title: string;
  photographer: string;
  eventName: string;
  location: string;
  eventSlug: string;
  capturedAt: string;
  priceUsd: string;
  usageRights: "editorial" | "commercial";
  filename: string;
  previewUrl: string;
  fullResUrl: string;
  storageKey: string;
  tags: string;
  attendeeKeywords: string;
  subjectNamingStatus: "" | "needs_manual" | "from_slate" | "from_match" | "manual_resolved";
  subjectNamingConfidence: string;
};

type BatchDefaults = {
  eventName: string;
  location: string;
  priceUsd: string;
  usageRights: UploadFormValues["usageRights"];
  tags: string;
  attendeeKeywords: string;
};

type SharedPreset = {
  id: string;
  name: string;
  folder: string;
  scope: "personal" | "team";
  isShared: boolean;
  isReadOnly: boolean;
  createdBy?: { name: string; email: string };
  approvedBy?: { name: string; email: string };
  canEdit?: boolean;
  canDelete?: boolean;
  canClone?: boolean;
  defaults: BatchDefaults;
};

type PresetHistoryEntry = {
  id: string;
  action: string;
  detail: string;
  createdAt: string;
  actor?: { name: string; email: string };
};

type QueueDraft = Partial<
  Pick<
    UploadFormValues,
    | "title"
    | "eventName"
    | "eventSlug"
    | "capturedAt"
    | "location"
    | "tags"
    | "attendeeKeywords"
    | "filename"
    | "previewUrl"
    | "fullResUrl"
    | "storageKey"
    | "subjectNamingStatus"
    | "subjectNamingConfidence"
  >
>;

type QueueItem = {
  id: string;
  file: File;
  voiceNote?: File;
  originalFilename: string;
  renameAppliedAt?: string;
  objectUrl: string;
  mediaKind: "image" | "video" | "unknown";
  filenameValid: boolean;
  filenameSuggestion?: string;
  localStatus: "idle" | "processing" | "done" | "error";
  cloudStatus: "idle" | "uploading" | "done" | "error";
  submitStatus: "idle" | "submitting" | "done" | "error";
  cloudProgress: number;
  draft: QueueDraft;
};

type AiUpdatableField =
  | "title"
  | "eventName"
  | "eventSlug"
  | "capturedAt"
  | "location"
  | "tags"
  | "attendeeKeywords";

function filenameStem(name: string) {
  return name.replace(/\.[^.]+$/, "").toLowerCase();
}

/** Preview + labels: invalid catalog names yield mediaKind "unknown" even for .jpg — infer from MIME/extension. */
function inferQueueItemMediaKind(item: Pick<QueueItem, "mediaKind" | "file">): "image" | "video" | "unknown" {
  if (item.mediaKind === "image" || item.mediaKind === "video") return item.mediaKind;
  const mime = item.file.type;
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  const ext = item.file.name.match(/\.([a-z0-9]+)$/i)?.[1] || "";
  return getMediaKindFromExtension(ext);
}

export default function UploadPage() {
  const [status, setStatus] = useState<UploadResponse | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAutoUploading, setIsAutoUploading] = useState(false);
  const [isCloudUploading, setIsCloudUploading] = useState(false);
  const [isBatchRunning, setIsBatchRunning] = useState(false);
  const [isBatchSubmitting, setIsBatchSubmitting] = useState(false);
  const [batchIncludeCloud, setBatchIncludeCloud] = useState(true);
  const [batchAutoSubmit, setBatchAutoSubmit] = useState(true);
  const [batchAutoApplySubjectMatches, setBatchAutoApplySubjectMatches] = useState(true);
  const [cloudProgress, setCloudProgress] = useState(0);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [activeQueueId, setActiveQueueId] = useState<string | null>(null);
  const queueRef = useRef<QueueItem[]>([]);
  const filePickerRef = useRef<HTMLInputElement | null>(null);
  const folderPickerRef = useRef<HTMLInputElement | null>(null);
  const batchDragDepthRef = useRef(0);
  const uploadFileInputId = "upload-file-input";
  const [batchBucketDragActive, setBatchBucketDragActive] = useState(false);
  const [role, setRole] = useState<string | null>(null);
  const [values, setValues] = useState<UploadFormValues>({
    title: "",
    photographer: "",
    eventName: "",
    location: "",
    eventSlug: "",
    capturedAt: "",
    priceUsd: "",
    usageRights: "editorial",
    filename: "",
    previewUrl: "",
    fullResUrl: "",
    storageKey: "",
    tags: "",
    attendeeKeywords: "",
    subjectNamingStatus: "",
    subjectNamingConfidence: "",
  });
  const [batchDefaults, setBatchDefaults] = useState<BatchDefaults>({
    eventName: "",
    location: "",
    priceUsd: "180",
    usageRights: "editorial",
    tags: "",
    attendeeKeywords: "",
  });
  const [presetName, setPresetName] = useState("");
  const [selectedPresetId, setSelectedPresetId] = useState("");
  const [savedPresets, setSavedPresets] = useState<SharedPreset[]>([]);
  const [presetShared, setPresetShared] = useState(true);
  const [presetScope, setPresetScope] = useState<"personal" | "team">("team");
  const [presetFolder, setPresetFolder] = useState("General");
  const [presetReadOnly, setPresetReadOnly] = useState(false);
  const [presetHistory, setPresetHistory] = useState<PresetHistoryEntry[]>([]);
  const [latestAiSuggestion, setLatestAiSuggestion] = useState<LatestAiSuggestion | null>(null);
  const [aiHighlightedFields, setAiHighlightedFields] = useState<(keyof UploadFormValues)[]>([]);
  const aiHighlightTimeoutRef = useRef<number | null>(null);
  const [clickedQueueCueId, setClickedQueueCueId] = useState<string | null>(null);
  const queueClickCueTimeoutRef = useRef<number | null>(null);
  /** True after "Apply to form" until queue/suggestion changes (stays lit so user does not re-click). */
  const [applyToFormClicked, setApplyToFormClicked] = useState(false);
  const [slateSelectMode, setSlateSelectMode] = useState(false);
  const [slateSelectBox, setSlateSelectBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [slateSelectImageSize, setSlateSelectImageSize] = useState<{
    displayW: number;
    displayH: number;
    naturalW: number;
    naturalH: number;
  } | null>(null);
  const [manualSlateOcrStatus, setManualSlateOcrStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [manualSlateOcrMessage, setManualSlateOcrMessage] = useState("");
  const slateSelectDragRef = useRef<{ startX: number; startY: number } | null>(null);
  const slateSelectImgRef = useRef<HTMLImageElement | null>(null);
  const slateSelectOverlayRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void (async () => {
      const response = await fetch("/api/auth/me");
      const data = (await response.json()) as {
        user: { role: string; name: string } | null;
      };
      setRole(data.user?.role ?? null);
      if (data.user?.name) {
        setValues((current) => ({ ...current, photographer: data.user?.name || "" }));
      }
    })();
  }, []);

  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  useEffect(() => {
    if (!slateSelectMode) return;
    const onWindowMouseUp = () => {
      slateSelectDragRef.current = null;
    };
    window.addEventListener("mouseup", onWindowMouseUp);
    return () => window.removeEventListener("mouseup", onWindowMouseUp);
  }, [slateSelectMode]);

  const refreshPresets = async () => {
    const response = await fetch("/api/upload/presets");
    const data = (await response.json()) as { ok: boolean; presets?: SharedPreset[] };
    if (!data.ok || !data.presets) return;
    setSavedPresets(data.presets);
    setSelectedPresetId((current) => {
      if (current && data.presets?.some((preset) => preset.id === current)) return current;
      return data.presets?.[0]?.id || "";
    });
  };

  const fetchPresetHistory = async (presetId: string) => {
    if (!presetId) {
      setPresetHistory([]);
      return;
    }
    const response = await fetch(`/api/upload/presets/${presetId}/history`);
    const data = (await response.json()) as {
      ok: boolean;
      history?: PresetHistoryEntry[];
      message?: string;
    };
    if (!data.ok || !data.history) {
      setPresetHistory([]);
      return;
    }
    setPresetHistory(data.history);
  };

  useEffect(() => {
    void refreshPresets();
  }, []);

  useEffect(() => {
    if (!selectedPresetId) {
      setPresetHistory([]);
      return;
    }
    void fetchPresetHistory(selectedPresetId);
  }, [selectedPresetId]);

  useEffect(
    () => () => {
      if (aiHighlightTimeoutRef.current) {
        window.clearTimeout(aiHighlightTimeoutRef.current);
      }
      if (queueClickCueTimeoutRef.current) {
        window.clearTimeout(queueClickCueTimeoutRef.current);
      }
      for (const item of queueRef.current) URL.revokeObjectURL(item.objectUrl);
    },
    [],
  );

  const activeQueueItem = useMemo(
    () => queue.find((item) => item.id === activeQueueId) ?? null,
    [activeQueueId, queue],
  );
  const activeQueueFilename = useMemo(
    () => (activeQueueItem ? activeQueueItem.draft.filename || activeQueueItem.file.name : ""),
    [activeQueueItem],
  );
  const invalidQueueCount = useMemo(
    () => queue.filter((item) => !item.filenameValid).length,
    [queue],
  );
  const renameReportRows = useMemo(
    () =>
      queue.filter(
        (item) =>
          item.originalFilename !== item.file.name ||
          Boolean(item.renameAppliedAt) ||
          !item.filenameValid,
      ),
    [queue],
  );
  const selectedPreset = useMemo(
    () => savedPresets.find((entry) => entry.id === selectedPresetId) ?? null,
    [savedPresets, selectedPresetId],
  );
  const presetDiffRows = useMemo(() => {
    if (!selectedPreset) return [];
    const rows = [
      { label: "Event name", preset: selectedPreset.defaults.eventName, current: batchDefaults.eventName },
      { label: "Location", preset: selectedPreset.defaults.location, current: batchDefaults.location },
      { label: "Price USD", preset: selectedPreset.defaults.priceUsd, current: batchDefaults.priceUsd },
      { label: "Usage rights", preset: selectedPreset.defaults.usageRights, current: batchDefaults.usageRights },
      { label: "Tags", preset: selectedPreset.defaults.tags, current: batchDefaults.tags },
      {
        label: "Attendee keywords",
        preset: selectedPreset.defaults.attendeeKeywords,
        current: batchDefaults.attendeeKeywords,
      },
    ];
    return rows
      .filter((row) => row.preset !== row.current)
      .map((row) => ({
        ...row,
        preset: row.preset || "(empty)",
        current: row.current || "(empty)",
      }));
  }, [batchDefaults, selectedPreset]);

  const setValue = <K extends keyof UploadFormValues>(key: K, value: UploadFormValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
  };

  const aiFieldClass = (key: keyof UploadFormValues) =>
    aiHighlightedFields.includes(key) ? "ring-2 ring-blue-300 bg-blue-50 transition" : "";
  const voiceTranscriptStatusLabel = (status: LatestAiSuggestion["voiceTranscriptStatus"]) => {
    switch (status) {
      case "transcribed":
        return "success";
      case "empty":
        return "no speech detected";
      case "request_failed":
        return "failed";
      case "unsupported_format":
        return "unsupported format";
      case "provider_disabled":
        return "provider disabled";
      case "missing_api_key":
        return "missing API key";
      default:
        return "not provided";
    }
  };
  const slateDetectionPassLabel = (pass: LatestAiSuggestion["slateDetectionPass"]) => {
    switch (pass) {
      case "full_frame":
        return "full frame";
      case "focused_center":
        return "focused center crop";
      case "focused_lower":
        return "focused lower crop";
      case "focused_tight_center":
        return "focused tight center";
      case "focused_tight_left":
        return "focused tight left";
      case "focused_foreground_slate":
        return "foreground slate (center)";
      case "focused_foreground_slate_left":
        return "foreground slate (left-held)";
      case "whiteboard_enhanced_foreground_slate":
        return "foreground slate enhanced (center)";
      case "whiteboard_enhanced_foreground_slate_left":
        return "foreground slate enhanced (left)";
      case "whiteboard_enhanced_foreground_slate_threshold":
        return "foreground slate threshold (center)";
      case "whiteboard_enhanced_foreground_slate_left_threshold":
        return "foreground slate threshold (left)";
      case "focused_board_candidate":
        return "auto board region";
      case "whiteboard_enhanced_board_candidate":
        return "auto board region enhanced";
      case "whiteboard_enhanced_board_candidate_threshold":
        return "auto board region threshold";
      case "whiteboard_enhanced_full":
        return "whiteboard enhanced full";
      case "whiteboard_enhanced_center":
        return "whiteboard enhanced center";
      case "whiteboard_enhanced_lower":
        return "whiteboard enhanced lower";
      case "whiteboard_enhanced_tight_center":
        return "whiteboard enhanced tight center";
      case "whiteboard_enhanced_tight_left":
        return "whiteboard enhanced tight left";
      case "whiteboard_enhanced_center_threshold":
        return "whiteboard enhanced center threshold";
      case "whiteboard_enhanced_lower_threshold":
        return "whiteboard enhanced lower threshold";
      case "whiteboard_enhanced_tight_center_threshold":
        return "whiteboard enhanced tight center threshold";
      case "whiteboard_enhanced_tight_left_threshold":
        return "whiteboard enhanced tight left threshold";
      default:
        return pass === "none" ? "not run" : pass.replaceAll("_", " ");
    }
  };

  useEffect(() => {
    if (!activeQueueFilename) return;
    setValues((current) =>
      current.filename === activeQueueFilename
        ? current
        : {
            ...current,
            filename: activeQueueFilename,
          },
    );
  }, [activeQueueFilename]);

  useEffect(() => {
    setApplyToFormClicked(false);
  }, [activeQueueId]);

  const applyLatestAiToForm = () => {
    if (!latestAiSuggestion) return;
    const nextValues = { ...values };
    const changedFields: AiUpdatableField[] = [];
    const aiUpdates: Array<[AiUpdatableField, string]> = [
      ["title", latestAiSuggestion.title],
      ["eventName", latestAiSuggestion.eventName],
      ["eventSlug", latestAiSuggestion.eventSlug],
      ["capturedAt", latestAiSuggestion.capturedAt],
      ["location", latestAiSuggestion.location],
      ["tags", latestAiSuggestion.tags],
      ["attendeeKeywords", latestAiSuggestion.attendeeKeywords],
    ];
    for (const [key, candidate] of aiUpdates) {
      if (!candidate || candidate === nextValues[key]) continue;
      nextValues[key] = candidate;
      changedFields.push(key);
    }
    const sns = latestAiSuggestion.subjectNamingStatus;
    if (sns === "from_slate" || sns === "from_match" || sns === "needs_manual") {
      nextValues.subjectNamingStatus = sns;
    }
    nextValues.subjectNamingConfidence =
      latestAiSuggestion.subjectConfidence != null
        ? String(latestAiSuggestion.subjectConfidence)
        : nextValues.subjectNamingConfidence;
    setValues(nextValues);
    setAiHighlightedFields(changedFields);
    if (aiHighlightTimeoutRef.current) {
      window.clearTimeout(aiHighlightTimeoutRef.current);
    }
    aiHighlightTimeoutRef.current = window.setTimeout(() => {
      setAiHighlightedFields([]);
      aiHighlightTimeoutRef.current = null;
    }, 1800);
    setStatus({
      ok: true,
      message:
        changedFields.length > 0
          ? `Applied AI suggestions to ${changedFields.length} field(s).`
          : "Applied AI suggestions (no field values changed).",
    });
    setApplyToFormClicked(true);
  };

  const applyOcrPassNameToForm = (rawCandidate: string) => {
    const cleaned = sanitizeDiagnosticCandidateName(rawCandidate);
    if (cleaned.length < 3) return;
    setValues((prev) => ({ ...prev, title: cleaned }));
    if (activeQueueId) {
      setQueue((current) =>
        current.map((item) =>
          item.id === activeQueueId
            ? { ...item, draft: { ...item.draft, title: cleaned } }
            : item,
        ),
      );
    }
    setLatestAiSuggestion((prev) =>
      prev
        ? {
            ...prev,
            title: cleaned,
            slateCandidateName: cleaned,
            slateDetected: true,
          }
        : null,
    );
    setApplyToFormClicked(false);
    setStatus({
      ok: true,
      message: `Title set to "${cleaned}" from pass diagnostics. Submit catalog when ready.`,
    });
    setAiHighlightedFields(["title"]);
    if (aiHighlightTimeoutRef.current) {
      window.clearTimeout(aiHighlightTimeoutRef.current);
    }
    aiHighlightTimeoutRef.current = window.setTimeout(() => {
      setAiHighlightedFields([]);
      aiHighlightTimeoutRef.current = null;
    }, 1800);
  };

  const applyLatestAiToBatchDefaults = () => {
    if (!latestAiSuggestion) return;
    setBatchDefaults((current) => ({
      ...current,
      eventName: latestAiSuggestion.eventName || current.eventName,
      location: latestAiSuggestion.location || current.location,
      tags: latestAiSuggestion.tags || current.tags,
      attendeeKeywords: latestAiSuggestion.attendeeKeywords || current.attendeeKeywords,
    }));
    setStatus({ ok: true, message: "Applied AI suggestions to batch defaults." });
  };

  const applyPreset = (presetId: string) => {
    const preset = savedPresets.find((entry) => entry.id === presetId);
    if (!preset) return;
    setBatchDefaults(preset.defaults);
    setPresetScope(preset.scope);
    setPresetFolder(preset.folder);
    setPresetShared(preset.isShared);
    setPresetReadOnly(preset.isReadOnly);
    void fetchPresetHistory(preset.id);
  };

  const cloneSelectedPreset = () => {
    if (!selectedPresetId) return;
    const selected = selectedPreset;
    if (!selected?.canClone) {
      setStatus({ ok: false, message: "Selected preset cannot be cloned." });
      return;
    }

    void (async () => {
      const response = await fetch(`/api/upload/presets/${selectedPresetId}/clone`, {
        method: "POST",
      });
      const data = (await response.json()) as {
        ok: boolean;
        message?: string;
        preset?: SharedPreset;
      };
      if (!data.ok || !data.preset) {
        setStatus({ ok: false, message: data.message || "Failed to clone preset." });
        return;
      }
      await refreshPresets();
      setSelectedPresetId(data.preset.id);
      setPresetName(data.preset.name);
      setStatus({ ok: true, message: `Cloned preset "${data.preset.name}".` });
      void fetchPresetHistory(data.preset.id);
    })();
  };

  const saveCurrentAsPreset = () => {
    void (async () => {
      const cleanName = presetName.trim();
      if (!cleanName) {
        setStatus({ ok: false, message: "Enter a preset name before saving." });
        return;
      }

      const selected = selectedPreset;
      const shouldUpdateExisting =
        !!selected && !!selected.canEdit && selected.name === cleanName;

      const response = await fetch("/api/upload/presets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: shouldUpdateExisting ? selectedPresetId : undefined,
          name: cleanName,
          folder: presetFolder,
          scope: presetScope,
          defaults: batchDefaults,
          isShared: presetShared,
          isReadOnly: presetReadOnly,
        }),
      });
      const data = (await response.json()) as {
        ok: boolean;
        message?: string;
        preset?: SharedPreset;
      };
      if (!data.ok || !data.preset) {
        setStatus({ ok: false, message: data.message || "Failed to save preset." });
        return;
      }

      await refreshPresets();
      setSelectedPresetId(data.preset.id);
      setPresetName("");
      setStatus({ ok: true, message: `Preset "${data.preset.name}" saved.` });
    })();
  };

  const deleteSelectedPreset = () => {
    if (!selectedPresetId) return;
    const selected = selectedPreset;
    if (!selected?.canDelete) {
      setStatus({ ok: false, message: "You cannot delete this preset." });
      return;
    }
    void (async () => {
      const response = await fetch(`/api/upload/presets/${selectedPresetId}`, {
        method: "DELETE",
      });
      const data = (await response.json()) as { ok: boolean; message?: string };
      if (!data.ok) {
        setStatus({ ok: false, message: data.message || "Failed to delete preset." });
        return;
      }
      await refreshPresets();
      setSelectedPresetId("");
      setStatus({ ok: true, message: "Preset deleted." });
    })();
  };

  const updateQueueItem = (id: string, patch: Partial<QueueItem>) => {
    setQueue((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  };

  const addFilesToQueue = (files: File[]) => {
    const mediaFiles = files.filter(
      (file) => file.type.startsWith("image/") || file.type.startsWith("video/"),
    );
    const wavFiles = files.filter((file) => /\.(wav|wave)$/i.test(file.name));
    if (mediaFiles.length === 0) {
      setStatus({ ok: false, message: "Only image/video files can be queued (with optional .wav notes)." });
      return;
    }

    const wavByStem = new Map<string, File>();
    for (const wav of wavFiles) wavByStem.set(filenameStem(wav.name), wav);

    const additions: QueueItem[] = mediaFiles.map((file) => ({
      ...(() => {
        const validation = validateMediaFilename(file.name);
        return {
          mediaKind: validation.ok ? validation.mediaKind : "unknown",
          filenameValid: validation.ok,
          filenameSuggestion: validation.ok
            ? undefined
            : validation.suggestion || suggestMediaFilename(file.name),
        };
      })(),
      id: crypto.randomUUID(),
      file,
      voiceNote: wavByStem.get(filenameStem(file.name)),
      originalFilename: file.name,
      objectUrl: URL.createObjectURL(file),
      localStatus: "idle",
      cloudStatus: "idle",
      submitStatus: "idle",
      cloudProgress: 0,
      draft: { filename: file.name },
    }));

    setQueue((current) => [...current, ...additions]);
    setActiveQueueId((current) => current ?? additions[0]?.id ?? null);
    const invalidCount = additions.filter((item) => !item.filenameValid).length;
    const voiceMatchCount = additions.filter((item) => item.voiceNote).length;
    if (invalidCount > 0) {
      setStatus({
        ok: false,
        message: `${invalidCount} file(s) added to Needs Rename queue. Use "Fix all invalid filenames" or apply suggestions per item.`,
      });
      return;
    }
    if (voiceMatchCount > 0) {
      setStatus({
        ok: true,
        message: `Matched ${voiceMatchCount} voice note(s). AI will use transcript to improve subject title.`,
      });
    }
  };

  const applySuggestedFilename = (id: string) => {
    let applied = false;
    setQueue((current) =>
      current.map((item) => {
        if (item.id !== id || item.filenameValid || !item.filenameSuggestion) return item;
        const renamedFile = new File([item.file], item.filenameSuggestion, {
          type: item.file.type,
          lastModified: item.file.lastModified,
        });
        URL.revokeObjectURL(item.objectUrl);
        const validation = validateMediaFilename(renamedFile.name);
        applied = true;
        return {
          ...item,
          file: renamedFile,
          objectUrl: URL.createObjectURL(renamedFile),
          mediaKind: validation.ok ? validation.mediaKind : "unknown",
          filenameValid: validation.ok,
          filenameSuggestion: validation.ok
            ? undefined
            : validation.suggestion || suggestMediaFilename(renamedFile.name),
          localStatus: "idle",
          cloudStatus: "idle",
          submitStatus: "idle",
          cloudProgress: 0,
          renameAppliedAt: new Date().toISOString(),
          draft: {
            ...item.draft,
            filename: renamedFile.name,
          },
        };
      }),
    );
    setStatus(
      applied
        ? { ok: true, message: "Suggested filename applied. This item is now ready for automation." }
        : { ok: false, message: "No suggested filename available for this item." },
    );
  };

  const fixAllInvalidFilenames = () => {
    let appliedCount = 0;
    setQueue((current) =>
      current.map((item) => {
        if (item.filenameValid || !item.filenameSuggestion) return item;
        const renamedFile = new File([item.file], item.filenameSuggestion, {
          type: item.file.type,
          lastModified: item.file.lastModified,
        });
        URL.revokeObjectURL(item.objectUrl);
        const validation = validateMediaFilename(renamedFile.name);
        appliedCount += 1;
        return {
          ...item,
          file: renamedFile,
          objectUrl: URL.createObjectURL(renamedFile),
          mediaKind: validation.ok ? validation.mediaKind : "unknown",
          filenameValid: validation.ok,
          filenameSuggestion: validation.ok
            ? undefined
            : validation.suggestion || suggestMediaFilename(renamedFile.name),
          localStatus: "idle",
          cloudStatus: "idle",
          submitStatus: "idle",
          cloudProgress: 0,
          renameAppliedAt: new Date().toISOString(),
          draft: {
            ...item.draft,
            filename: renamedFile.name,
          },
        };
      }),
    );
    setStatus(
      appliedCount > 0
        ? { ok: true, message: `Applied suggested filenames for ${appliedCount} queue item(s).` }
        : { ok: false, message: "No invalid filenames found in the queue." },
    );
  };

  const escapeCsv = (value: string) => `"${value.replace(/"/g, '""')}"`;

  const exportRenameReportCsv = () => {
    if (renameReportRows.length === 0) {
      setStatus({ ok: false, message: "No rename activity found to export yet." });
      return;
    }
    const header = [
      "queue_id",
      "media_kind",
      "original_filename",
      "current_filename",
      "filename_valid",
      "suggested_filename",
      "rename_applied_at",
    ];
    const lines = renameReportRows.map((item) =>
      [
        item.id,
        item.mediaKind,
        item.originalFilename,
        item.file.name,
        String(item.filenameValid),
        item.filenameSuggestion || "",
        item.renameAppliedAt || "",
      ]
        .map((value) => escapeCsv(value))
        .join(","),
    );
    const csv = [header.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `rename-report-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setStatus({ ok: true, message: `Exported rename report CSV (${renameReportRows.length} row(s)).` });
  };

  const removeQueueItem = (id: string) => {
    setQueue((current) => {
      const target = current.find((item) => item.id === id);
      if (target) URL.revokeObjectURL(target.objectUrl);
      const next = current.filter((item) => item.id !== id);
      if (activeQueueId === id) {
        setActiveQueueId(next[0]?.id ?? null);
      }
      return next;
    });
  };

  const handleDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    batchDragDepthRef.current = 0;
    setBatchBucketDragActive(false);
    const dropped = Array.from(event.dataTransfer.files);
    addFilesToQueue(dropped);
  };

  const handleBatchBucketDragEnter = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    batchDragDepthRef.current += 1;
    setBatchBucketDragActive(true);
  };

  const handleBatchBucketDragLeave = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    batchDragDepthRef.current = Math.max(0, batchDragDepthRef.current - 1);
    if (batchDragDepthRef.current === 0) {
      setBatchBucketDragActive(false);
    }
  };

  const handleBatchBucketDragOver = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };

  const selectQueueItemWithCue = (id: string) => {
    setActiveQueueId(id);
    setClickedQueueCueId(id);
    if (queueClickCueTimeoutRef.current) {
      window.clearTimeout(queueClickCueTimeoutRef.current);
    }
    queueClickCueTimeoutRef.current = window.setTimeout(() => {
      setClickedQueueCueId(null);
      queueClickCueTimeoutRef.current = null;
    }, 550);
  };

  const canDecodeImageFile = async (file: File) => {
    if (typeof window === "undefined") return true;
    try {
      if ("createImageBitmap" in window) {
        const bitmap = await createImageBitmap(file);
        bitmap.close();
        return true;
      }
    } catch {
      return false;
    }

    return await new Promise<boolean>((resolve) => {
      const objectUrl = URL.createObjectURL(file);
      const img = new window.Image();
      const timeoutId = setTimeout(() => {
        URL.revokeObjectURL(objectUrl);
        resolve(false);
      }, 10000);
      img.onload = () => {
        clearTimeout(timeoutId);
        URL.revokeObjectURL(objectUrl);
        resolve(true);
      };
      img.onerror = () => {
        clearTimeout(timeoutId);
        URL.revokeObjectURL(objectUrl);
        resolve(false);
      };
      img.src = objectUrl;
    });
  };

  const uploadPartWithProgress = (
    signedUrl: string,
    chunk: Blob,
    onProgress: (loaded: number) => void,
  ) =>
    new Promise<string>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", signedUrl);
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress(event.loaded);
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          const etag = xhr.getResponseHeader("ETag");
          if (!etag) {
            reject(new Error("Missing ETag from uploaded part."));
            return;
          }
          resolve(etag);
          return;
        }
        reject(new Error(`Part upload failed with status ${xhr.status}.`));
      };
      xhr.onerror = () => reject(new Error("Part upload request failed."));
      xhr.send(chunk);
    });

  const handleCloudMultipartUpload = async (targetItem?: QueueItem) => {
    const item = targetItem ?? activeQueueItem;
    if (!item) {
      setStatus({ ok: false, message: "Please choose an image file first." });
      return false;
    }
    if (!item.filenameValid) {
      setStatus({
        ok: false,
        message: `Filename is invalid for "${item.file.name}". Apply the suggested name first.`,
      });
      updateQueueItem(item.id, { cloudStatus: "error" });
      return false;
    }
    setIsCloudUploading(true);
    setCloudProgress(0);
    updateQueueItem(item.id, {
      cloudStatus: "uploading",
      cloudProgress: 0,
    });
    setStatus(null);

    let uploadId = "";
    let storageKey = "";
    try {
      const startResponse = await fetch("/api/upload/multipart/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: item.file.name,
          contentType: item.file.type || "application/octet-stream",
          sizeBytes: item.file.size,
        }),
      });
      const startData = (await startResponse.json()) as {
        ok: boolean;
        message?: string;
        data?: { uploadId: string; key: string; partSizeBytes: number; partCount: number };
      };
      if (!startData.ok || !startData.data) {
        throw new Error(startData.message || "Unable to start multipart upload.");
      }
      const uploadPlan = startData.data;

      uploadId = uploadPlan.uploadId;
      storageKey = uploadPlan.key;
      const partCount = uploadPlan.partCount;
      const loadedByPart = Array.from({ length: partCount }, () => 0);
      const parts: Array<{ PartNumber: number; ETag: string }> = [];

      const updateProgress = () => {
        const uploadedBytes = loadedByPart.reduce((sum, loaded) => sum + loaded, 0);
        const pct = Math.min(
          100,
          Math.round((uploadedBytes / item.file.size) * 100),
        );
        setCloudProgress(pct);
        updateQueueItem(item.id, { cloudProgress: pct });
      };

      const uploadOnePart = async (index: number) => {
        const partNumber = index + 1;
        const signResponse = await fetch("/api/upload/multipart/sign-part", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: storageKey, uploadId, partNumber }),
        });
        const signData = (await signResponse.json()) as {
          ok: boolean;
          message?: string;
          data?: { signedUrl: string };
        };
        if (!signData.ok || !signData.data?.signedUrl) {
          throw new Error(signData.message || `Unable to sign part ${partNumber}.`);
        }

        const start = index * uploadPlan.partSizeBytes;
        const end = Math.min(start + uploadPlan.partSizeBytes, item.file.size);
        const chunk = item.file.slice(start, end);
        const etag = await uploadPartWithProgress(signData.data.signedUrl, chunk, (loaded) => {
          loadedByPart[index] = loaded;
          updateProgress();
        });
        loadedByPart[index] = chunk.size;
        updateProgress();
        parts.push({ PartNumber: partNumber, ETag: etag });
      };

      const concurrency = 4;
      let cursor = 0;
      const worker = async () => {
        while (cursor < partCount) {
          const currentIndex = cursor;
          cursor += 1;
          await uploadOnePart(currentIndex);
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(concurrency, partCount) }, () => worker()),
      );

      const completeResponse = await fetch("/api/upload/multipart/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: storageKey, uploadId, parts }),
      });
      const completeData = (await completeResponse.json()) as {
        ok: boolean;
        message?: string;
        data?: { storageKey: string; fullResUrl?: string | null };
      };
      if (!completeData.ok || !completeData.data) {
        throw new Error(completeData.message || "Unable to complete multipart upload.");
      }

      setValues((current) => ({
        ...current,
        storageKey: completeData.data?.storageKey || current.storageKey,
        fullResUrl: completeData.data?.fullResUrl || current.fullResUrl,
      }));
      updateQueueItem(item.id, {
        cloudStatus: "done",
        cloudProgress: 100,
        draft: {
          ...item.draft,
          storageKey: completeData.data?.storageKey ?? item.draft.storageKey,
          fullResUrl: completeData.data?.fullResUrl ?? item.draft.fullResUrl,
        },
      });
      setStatus({
        ok: true,
        message: "Cloud full-res upload complete. Storage key has been attached to this record.",
      });
      setCloudProgress(100);
    } catch (error) {
      if (uploadId && storageKey) {
        void fetch("/api/upload/multipart/abort", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: storageKey, uploadId }),
        });
      }
      setStatus({
        ok: false,
        message: error instanceof Error ? error.message : "Cloud upload failed.",
      });
      updateQueueItem(item.id, { cloudStatus: "error" });
      return false;
    } finally {
      setIsCloudUploading(false);
    }
    return true;
  };

  const runManualSlateOcr = async () => {
    const item = activeQueueItem;
    if (!item || item.mediaKind !== "image" || !slateSelectBox || !slateSelectImageSize || !slateSelectImgRef.current) {
      setManualSlateOcrMessage("Select a region first by dragging on the image.");
      setManualSlateOcrStatus("error");
      return;
    }
    const { displayW, displayH, naturalW, naturalH } = slateSelectImageSize;
    const { x, y, w, h } = slateSelectBox;
    if (w < 10 || h < 10) {
      setManualSlateOcrMessage("Selection too small. Draw a larger box around the slate.");
      setManualSlateOcrStatus("error");
      return;
    }
    const sx = Math.max(0, (x / displayW) * naturalW);
    const sy = Math.max(0, (y / displayH) * naturalH);
    const sw = Math.min(naturalW - sx, (w / displayW) * naturalW);
    const sh = Math.min(naturalH - sy, (h / displayH) * naturalH);
    if (sw < 10 || sh < 10) {
      setManualSlateOcrMessage("Selection too small.");
      setManualSlateOcrStatus("error");
      return;
    }
    setManualSlateOcrStatus("loading");
    setManualSlateOcrMessage("");
    try {
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(sw);
      canvas.height = Math.round(sh);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas 2d not available");
      ctx.drawImage(slateSelectImgRef.current, sx, sy, sw, sh, 0, 0, sw, sh);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), "image/png", 0.95)
      );
      if (!blob) throw new Error("Failed to create crop image");
      const formData = new FormData();
      formData.append("image", blob, "slate-crop.png");
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30_000);
      const response = await fetch("/api/upload/ocr-region", {
        method: "POST",
        body: formData,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      const text = await response.text();
      let result: {
        ok: boolean;
        candidateName?: string;
        rawText?: string;
        message?: string;
        provider?: "google" | "tesseract";
      };
      try {
        result = JSON.parse(text) as typeof result;
      } catch {
        const gateway = response.status === 502 || response.status === 503 || response.status === 504;
        setManualSlateOcrMessage(
          gateway
            ? `Server gateway error (${response.status}). The request may be timing out—check Railway logs and increase timeout if needed.`
            : "Server returned an error page instead of JSON. Check Railway logs and that GOOGLE_CLOUD_VISION_API_KEY is valid."
        );
        setManualSlateOcrStatus("error");
        return;
      }
      if (!result.ok) {
        setManualSlateOcrMessage(result.message || "OCR request failed");
        setManualSlateOcrStatus("error");
        return;
      }
      const candidateName = result.candidateName?.trim() || "";
      if (candidateName) {
        setValues((prev) => ({ ...prev, title: candidateName }));
        setLatestAiSuggestion((prev) =>
          prev
            ? {
                ...prev,
                slateCandidateName: candidateName,
                slateDetected: true,
                slateApplied: true,
                slateConfidence: 0.9,
                title: candidateName,
              }
            : null
        );
        setApplyToFormClicked(false);
        setManualSlateOcrMessage(
          result.provider === "google"
            ? `Applied "${candidateName}" to title (Google Vision).`
            : `Applied "${candidateName}" to title.`
        );
      } else {
        setManualSlateOcrMessage(
          result.rawText
            ? `No name parsed from region. Raw OCR: "${result.rawText.slice(0, 80)}${result.rawText.length > 80 ? "…" : ""}"`
            : "No text detected."
        );
      }
      setManualSlateOcrStatus("done");
    } catch (e) {
      const isAbort = e instanceof Error && e.name === "AbortError";
      const msg = e instanceof Error ? e.message : "";
      const isNetwork = msg === "Failed to fetch" || msg.includes("fetch") || msg.includes("network");
      const message =
        isAbort
          ? "OCR timed out (30s). Check that GOOGLE_CLOUD_VISION_API_KEY is set on Railway and try again."
          : isNetwork
            ? "Request failed. Check: (1) GOOGLE_CLOUD_VISION_API_KEY is set in Railway Variables, (2) you redeployed after adding it, (3) no ad-blocker is blocking the request."
            : msg || "OCR failed";
      setManualSlateOcrMessage(message);
      setManualSlateOcrStatus("error");
    }
  };

  const handleAutoUpload = async (item: QueueItem) => {
    if (!item.filenameValid) {
      setStatus({
        ok: false,
        message: `Filename is invalid for "${item.file.name}". Apply the suggested name first.`,
      });
      updateQueueItem(item.id, { localStatus: "error" });
      return false;
    }
    if (item.mediaKind !== "image") {
      setStatus({
        ok: false,
        message:
          "Local automation currently supports images only. Video files can be cloud-uploaded after naming validation.",
      });
      updateQueueItem(item.id, { localStatus: "error" });
      return false;
    }
    const decodable = await canDecodeImageFile(item.file);
    if (!decodable) {
      setStatus({
        ok: false,
        message:
          "Unsupported or corrupted image file. Please export a standard JPG/PNG/WebP from your editor and retry.",
      });
      updateQueueItem(item.id, { localStatus: "error" });
      return false;
    }
    setIsAutoUploading(true);
    setStatus(null);
    updateQueueItem(item.id, { localStatus: "processing" });
    const payload = new FormData();
    payload.append("file", item.file);
    if (item.voiceNote) payload.append("voiceNote", item.voiceNote);
    payload.append("autoApplySubjectMatches", batchAutoApplySubjectMatches ? "1" : "0");
    const controller = new AbortController();
    const timeoutMs = 90000;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    let data: UploadAutomationResponse;
    try {
      const response = await fetch("/api/upload/file", {
        method: "POST",
        body: payload,
        signal: controller.signal,
      });
      data = (await response.json()) as UploadAutomationResponse;
    } catch (error) {
      const message =
        error instanceof Error && error.name === "AbortError"
          ? "Upload automation timed out. Please retry or process fewer files at once."
          : error instanceof Error
            ? error.message
            : "Upload automation failed.";
      setStatus({ ok: false, message });
      updateQueueItem(item.id, { localStatus: "error" });
      return false;
    } finally {
      clearTimeout(timeoutId);
      setIsAutoUploading(false);
    }
    setStatus({ ok: data.ok, message: data.message });

    if (!data.ok || !data.data) {
      if (data.suggestion) {
        setStatus({
          ok: false,
          message: `${data.message} Suggested filename: ${data.suggestion}`,
        });
      }
      updateQueueItem(item.id, { localStatus: "error" });
      return false;
    }
    updateQueueItem(item.id, { localStatus: "done" });
    const suggestedTags = data.data?.suggestions?.suggestedTags?.join(", ") || "";
    const suggestedAttendeeKeywords =
      data.data?.suggestions?.suggestedAttendeeKeywords?.join(", ") || "";
    const nextDraft: QueueDraft = {
      ...item.draft,
      filename: data.data?.filename || item.draft.filename,
      previewUrl: data.data?.previewUrl || item.draft.previewUrl,
      fullResUrl: data.data?.fullResUrl || item.draft.fullResUrl,
      storageKey: data.data?.storageKey || item.draft.storageKey,
      capturedAt: data.data?.suggestions?.capturedAt || item.draft.capturedAt,
      eventSlug: data.data?.suggestions?.eventSlug || item.draft.eventSlug,
      eventName: data.data?.suggestions?.suggestedEventName || item.draft.eventName,
      title: data.data?.suggestions?.suggestedTitle || item.draft.title,
      location: data.data?.suggestions?.suggestedLocation || item.draft.location,
      tags: suggestedTags || item.draft.tags,
      attendeeKeywords: suggestedAttendeeKeywords || item.draft.attendeeKeywords,
      subjectNamingStatus: (() => {
        const sns = data.data?.suggestions?.subjectNamingStatus;
        if (sns === "from_slate" || sns === "from_match" || sns === "needs_manual") return sns;
        return item.draft.subjectNamingStatus || "";
      })(),
      subjectNamingConfidence:
        data.data?.suggestions?.subjectConfidence != null
          ? String(data.data.suggestions.subjectConfidence)
          : item.draft.subjectNamingConfidence || "",
    };
    updateQueueItem(item.id, { draft: nextDraft });
    setValues((current) => ({
      ...current,
      filename: nextDraft.filename || current.filename,
      previewUrl: nextDraft.previewUrl || current.previewUrl,
      fullResUrl: nextDraft.fullResUrl || current.fullResUrl,
      storageKey: nextDraft.storageKey || current.storageKey,
      capturedAt: nextDraft.capturedAt || current.capturedAt,
      eventSlug: nextDraft.eventSlug || current.eventSlug,
      eventName: nextDraft.eventName || current.eventName,
      title: nextDraft.title || current.title,
      location: nextDraft.location || current.location,
      tags: nextDraft.tags || current.tags,
      attendeeKeywords: nextDraft.attendeeKeywords || current.attendeeKeywords,
      subjectNamingStatus: nextDraft.subjectNamingStatus || current.subjectNamingStatus,
      subjectNamingConfidence: nextDraft.subjectNamingConfidence || current.subjectNamingConfidence,
    }));
    setBatchDefaults((current) => ({
      ...current,
      eventName: current.eventName || nextDraft.eventName || "",
      location: current.location || nextDraft.location || "",
      tags: current.tags || nextDraft.tags || "",
      attendeeKeywords: current.attendeeKeywords || nextDraft.attendeeKeywords || "",
    }));
    setApplyToFormClicked(false);
    setLatestAiSuggestion({
      title: data.data?.suggestions?.suggestedTitle || "",
      eventName: data.data?.suggestions?.suggestedEventName || "",
      eventSlug: data.data?.suggestions?.eventSlug || "",
      capturedAt: data.data?.suggestions?.capturedAt || "",
      location: data.data?.suggestions?.suggestedLocation || "",
      tags: suggestedTags,
      attendeeKeywords: suggestedAttendeeKeywords,
      captionDraft: data.data?.suggestions?.captionDraft || "",
      voiceTranscript: data.data?.suggestions?.voiceTranscript || "",
      voiceNoteMatched: data.data?.suggestions?.voiceNoteMatched ?? Boolean(item.voiceNote),
      voiceTranscriptStatus: data.data?.suggestions?.voiceTranscriptStatus || "not_provided",
      voiceTranscriptMessage: data.data?.suggestions?.voiceTranscriptMessage || "",
      voiceTitleCandidate: data.data?.suggestions?.voiceTitleCandidate || "",
      voiceTitleApplied: data.data?.suggestions?.voiceTitleApplied ?? false,
      slateDetected: data.data?.suggestions?.slateDetected ?? false,
      slateCandidateName: data.data?.suggestions?.slateCandidateName || "",
      slateConfidence: data.data?.suggestions?.slateConfidence ?? 0,
      slateApplied: data.data?.suggestions?.slateApplied ?? false,
      slateDetectionPass: data.data?.suggestions?.slateDetectionPass || "none",
      slateModelUsed: data.data?.suggestions?.slateModelUsed || "",
      slateFallbackAttempted: data.data?.suggestions?.slateFallbackAttempted ?? false,
      slateMessage: data.data?.suggestions?.slateMessage || "",
      slatePasses: data.data?.suggestions?.slatePasses || [],
      subjectName: data.data?.suggestions?.subjectName || "",
      subjectSource: data.data?.suggestions?.subjectSource || "none",
      subjectConfidence: data.data?.suggestions?.subjectConfidence ?? 0,
      subjectNamingStatus: data.data?.suggestions?.subjectNamingStatus ?? null,
      confidence: data.data?.suggestions?.confidence ?? 0,
      source: data.data?.suggestions?.source || "fallback",
    });
    return true;
  };

  const buildPayloadFromQueueItem = (item: QueueItem): UploadFormValues | null => {
    if (!item.filenameValid || item.mediaKind !== "image") return null;
    const payload: UploadFormValues = {
      title: item.draft.title || "",
      photographer: values.photographer,
      eventName: item.draft.eventName || batchDefaults.eventName,
      location: batchDefaults.location,
      eventSlug: item.draft.eventSlug || "",
      capturedAt: item.draft.capturedAt || "",
      priceUsd: batchDefaults.priceUsd,
      usageRights: batchDefaults.usageRights,
      filename: item.draft.filename || item.file.name,
      previewUrl: item.draft.previewUrl || "",
      fullResUrl: item.draft.fullResUrl || "",
      storageKey: item.draft.storageKey || "",
      tags: batchDefaults.tags,
      attendeeKeywords: batchDefaults.attendeeKeywords,
      subjectNamingStatus: item.draft.subjectNamingStatus || "",
      subjectNamingConfidence: item.draft.subjectNamingConfidence || "",
    };

    const missingRequired = !payload.title || !payload.eventName || !payload.eventSlug || !payload.capturedAt;
    if (missingRequired) return null;
    return payload;
  };

  const submitQueueItem = async (item: QueueItem) => {
    const payload = buildPayloadFromQueueItem(item);
    if (!payload) {
      updateQueueItem(item.id, { submitStatus: "error" });
      return false;
    }

    updateQueueItem(item.id, { submitStatus: "submitting" });
    const { subjectNamingStatus: sns, subjectNamingConfidence: snc, ...catalogFields } = payload;
    const response = await fetch("/api/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...catalogFields,
        ...(sns === "needs_manual" || sns === "from_slate" || sns === "from_match" || sns === "manual_resolved"
          ? { subjectNamingStatus: sns }
          : {}),
        ...(snc !== "" && Number.isFinite(Number.parseFloat(snc))
          ? { subjectNamingConfidence: Number.parseFloat(snc) }
          : {}),
      }),
    });
    const data = (await response.json()) as UploadResponse;
    if (!data.ok) {
      updateQueueItem(item.id, { submitStatus: "error" });
      setStatus(data);
      return false;
    }

    updateQueueItem(item.id, { submitStatus: "done" });
    return true;
  };

  const runBatchAutomation = async () => {
    if (queue.length === 0) {
      setStatus({ ok: false, message: "Queue is empty. Add photos first." });
      return;
    }
    setIsBatchRunning(true);

    for (const item of queue) {
      setActiveQueueId(item.id);
      const localOk = await handleAutoUpload(item);
      if (!localOk) continue;
      if (batchIncludeCloud) {
        const cloudOk = await handleCloudMultipartUpload(item);
        if (!cloudOk) continue;
      }
      if (batchAutoSubmit) {
        setIsBatchSubmitting(true);
        await submitQueueItem(item);
        setIsBatchSubmitting(false);
      }
    }

    setStatus({
      ok: true,
      message: batchAutoSubmit
        ? `Batch automation + submit complete for ${queue.length} queued photo(s).`
        : `Batch automation complete for ${queue.length} queued photo(s).`,
    });
    setIsBatchRunning(false);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setStatus(null);

    const normalizedFilename =
      activeQueueFilename && !validateMediaFilename(values.filename).ok
        ? activeQueueFilename
        : values.filename;
    const payload: UploadFormValues =
      normalizedFilename === values.filename ? values : { ...values, filename: normalizedFilename };
    if (normalizedFilename !== values.filename) {
      setValues((current) => ({ ...current, filename: normalizedFilename }));
    }

    const { subjectNamingStatus: snsSingle, subjectNamingConfidence: sncSingle, ...catalogSingle } =
      payload;
    const response = await fetch("/api/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...catalogSingle,
        ...(snsSingle === "needs_manual" ||
        snsSingle === "from_slate" ||
        snsSingle === "from_match" ||
        snsSingle === "manual_resolved"
          ? { subjectNamingStatus: snsSingle }
          : {}),
        ...(sncSingle !== "" && Number.isFinite(Number.parseFloat(sncSingle))
          ? { subjectNamingConfidence: Number.parseFloat(sncSingle) }
          : {}),
      }),
    });

    const data = (await response.json()) as UploadResponse;
    setStatus(data);
    setIsSubmitting(false);

    if (data.ok) {
      setValues((current) => ({
        ...current,
        title: "",
        eventName: "",
        location: "",
        eventSlug: "",
        capturedAt: "",
        priceUsd: "",
        usageRights: "editorial",
        filename: "",
        previewUrl: "",
        fullResUrl: "",
        storageKey: "",
        tags: "",
        attendeeKeywords: "",
        subjectNamingStatus: "",
        subjectNamingConfidence: "",
      }));
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <header>
        <p className="text-xs uppercase tracking-wide text-slate-500">Contributor Portal</p>
        <h1 className="text-3xl font-semibold text-slate-900">Photographer Upload</h1>
        <p className="mt-2 text-sm text-slate-600">
          Drop a whole batch of event photos into the bucket below—we read handheld slates and
          whiteboards (OCR), match people you already named, and suggest catalog-ready filenames and
          titles.
        </p>
        <p className="mt-2 text-sm">
          <Link
            href="/upload/needs-names"
            className="font-semibold text-amber-800 underline decoration-amber-600/60 underline-offset-2 hover:text-amber-900"
          >
            Name queue
          </Link>
          <span className="text-slate-600">
            {" "}
            — images we could not auto-name (no slate / no match). After you get a slate shot, we
            re-try matches in the background.
          </span>
        </p>
      </header>

      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <div
          role="region"
          aria-label="Batch upload bucket"
          onDragEnter={handleBatchBucketDragEnter}
          onDragLeave={handleBatchBucketDragLeave}
          onDragOver={handleBatchBucketDragOver}
          onDrop={handleDrop}
          className={`mb-4 rounded-2xl border-2 border-dashed p-6 transition-colors md:p-8 ${
            batchBucketDragActive
              ? "border-indigo-500 bg-indigo-50/90 shadow-inner"
              : "border-indigo-200/80 bg-gradient-to-b from-indigo-50/70 to-white"
          }`}
        >
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">
                Batch bucket
              </p>
              <h2 className="mt-1 text-lg font-semibold text-slate-900 md:text-xl">
                Drop your event photos here
              </h2>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-slate-600">
                Add many images at once (or a whole folder). We use OCR on handheld slates and
                whiteboards, visual matching for repeat guests, and your filename rules—then fill in
                titles and metadata automatically.
              </p>
              <ol className="mt-3 list-decimal space-y-1 pl-5 text-xs text-slate-600">
                <li>Add files to the bucket (drag-and-drop or browse).</li>
                <li>
                  If filenames need our catalog pattern, use{" "}
                  <span className="font-semibold text-slate-800">Fix all invalid filenames</span>{" "}
                  below.
                </li>
                <li>
                  Run <span className="font-semibold text-slate-800">Auto-process</span> on the
                  queue (or batch autopilot) to OCR slates and apply names.
                </li>
              </ol>
            </div>
            <div className="flex shrink-0 flex-col gap-2 sm:flex-row md:flex-col">
              <button
                type="button"
                onClick={() => filePickerRef.current?.click()}
                disabled={isAutoUploading}
                className="rounded-xl bg-indigo-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-800 disabled:opacity-50"
              >
                Choose images
              </button>
              <button
                type="button"
                onClick={() => folderPickerRef.current?.click()}
                disabled={isAutoUploading}
                className="rounded-xl border border-indigo-300 bg-white px-4 py-2.5 text-sm font-semibold text-indigo-900 hover:bg-indigo-50 disabled:opacity-50"
              >
                Choose folder
              </button>
            </div>
          </div>
          <input
            ref={filePickerRef}
            id={uploadFileInputId}
            type="file"
            accept="image/jpeg,image/jpg,image/png,image/webp,video/mp4,video/quicktime,video/x-m4v,video/webm,audio/wav,audio/x-wav"
            className="sr-only"
            disabled={isAutoUploading}
            multiple
            onChange={(event) => {
              const files = event.target.files ? Array.from(event.target.files) : [];
              event.target.value = "";
              if (files.length > 0) addFilesToQueue(files);
            }}
          />
          <input
            ref={folderPickerRef}
            type="file"
            className="sr-only"
            disabled={isAutoUploading}
            multiple
            aria-label="Choose a folder of images and videos"
            onChange={(event) => {
              const files = event.target.files ? Array.from(event.target.files) : [];
              event.target.value = "";
              if (files.length > 0) addFilesToQueue(files);
            }}
            {...({ webkitdirectory: "" } as Record<string, string>)}
          />
          <p className="mt-5 text-center text-xs text-slate-500">
            {batchBucketDragActive ? (
              <span className="font-semibold text-indigo-800">Release to add to your batch</span>
            ) : (
              <span>Or drag files from your computer anywhere onto this shaded area.</span>
            )}
          </p>
        </div>
          {queue.length > 0 ? (
            <div className="mt-3 space-y-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-900">Your batch</h3>
                <p className="text-xs text-slate-500">
                  {queue.length} file{queue.length === 1 ? "" : "s"} queued
                </p>
              </div>
              {invalidQueueCount > 0 ? (
                <div className="flex items-center justify-between rounded-lg border border-rose-200 bg-rose-50 px-3 py-2">
                  <p className="text-xs text-rose-800">
                    Needs Rename: {invalidQueueCount} file(s) do not match naming convention.
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={fixAllInvalidFilenames}
                      className="rounded-md bg-rose-700 px-2 py-1 text-[11px] font-semibold text-white"
                    >
                      Fix all invalid filenames
                    </button>
                    <button
                      type="button"
                      onClick={exportRenameReportCsv}
                      className="rounded-md border border-rose-300 bg-white px-2 py-1 text-[11px] font-semibold text-rose-800"
                    >
                      Export rename report CSV
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={exportRenameReportCsv}
                    disabled={renameReportRows.length === 0}
                    className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 disabled:opacity-50"
                  >
                    Export rename report CSV
                  </button>
                </div>
              )}
              <div className="grid gap-2 md:grid-cols-3">
                {queue.map((item) => {
                  const displayKind = inferQueueItemMediaKind(item);
                  return (
                  <div
                    key={item.id}
                    className={`relative rounded-xl border p-2 transition ${
                      activeQueueId === item.id
                        ? "border-blue-700 bg-blue-50 shadow-sm ring-2 ring-blue-300"
                        : "border-slate-300"
                    } ${clickedQueueCueId === item.id ? "scale-[1.01] ring-4 ring-emerald-300" : ""}`}
                  >
                    {activeQueueId === item.id ? (
                      <span className="absolute right-2 top-2 z-10 rounded-full bg-blue-700 px-2 py-0.5 text-[10px] font-semibold text-white">
                        Selected
                      </span>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => selectQueueItemWithCue(item.id)}
                      aria-pressed={activeQueueId === item.id}
                      className="w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                    >
                      {displayKind === "image" ? (
                        <Image
                          src={item.objectUrl}
                          alt={item.file.name}
                          width={320}
                          height={96}
                          unoptimized
                          className="h-24 w-full rounded object-cover"
                        />
                      ) : displayKind === "video" ? (
                        <div className="flex h-24 w-full items-center justify-center rounded bg-slate-100 text-xs text-slate-600">
                          Video file
                        </div>
                      ) : (
                        <div className="flex h-24 w-full items-center justify-center rounded bg-slate-100 text-xs text-slate-600">
                          File preview
                        </div>
                      )}
                      <p className="mt-1 truncate text-xs text-slate-700">{item.file.name}</p>
                      <p className="text-[10px] text-slate-500">
                        Type: {displayKind}
                        {!item.filenameValid && displayKind !== "unknown"
                          ? " · rename for catalog"
                          : null}
                      </p>
                      {item.voiceNote ? (
                        <p className="text-[10px] text-emerald-700">Voice note: {item.voiceNote.name}</p>
                      ) : null}
                      <p className="text-[10px] text-slate-500">
                        Local: {item.localStatus} · Cloud: {item.cloudStatus} ({item.cloudProgress}
                        %) · Submit: {item.submitStatus}
                      </p>
                      {!item.filenameValid ? (
                        <p className="mt-1 text-[10px] text-rose-700">
                          Needs rename: {item.filenameSuggestion || suggestMediaFilename(item.file.name)}
                        </p>
                      ) : null}
                    </button>
                    {!item.filenameValid ? (
                      <button
                        type="button"
                        onClick={() => applySuggestedFilename(item.id)}
                        className="mt-1 inline-block text-[10px] font-semibold text-blue-700"
                      >
                        Use suggested name
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => removeQueueItem(item.id)}
                      className="mt-1 inline-block text-[10px] text-rose-600"
                    >
                      remove
                    </button>
                  </div>
                  );
                })}
              </div>
            </div>
          ) : null}
          {queue.length > 0 ? (
            <p className="mt-2 text-xs font-medium text-blue-700">
              Selected file: {activeQueueItem ? activeQueueItem.file.name : "none"}
            </p>
          ) : null}
          {queue.length > 0 ? (
            <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold text-slate-800">Queue autopilot</p>
              <div className="mt-2 grid gap-2 md:grid-cols-4">
                <input
                  value={presetName}
                  onChange={(event) => setPresetName(event.target.value)}
                  placeholder="Preset name"
                  className="rounded-xl border border-slate-300 px-2 py-1.5 text-xs"
                />
                <input
                  value={presetFolder}
                  onChange={(event) => setPresetFolder(event.target.value)}
                  placeholder="Folder"
                  className="rounded-xl border border-slate-300 px-2 py-1.5 text-xs"
                />
                <button
                  type="button"
                  onClick={saveCurrentAsPreset}
                  className="rounded-xl bg-slate-800 px-2 py-1.5 text-xs font-semibold text-white"
                >
                  Save preset
                </button>
                <div className="flex gap-2">
                  <select
                    value={selectedPresetId}
                    onChange={(event) => {
                      const id = event.target.value;
                      setSelectedPresetId(id);
                      const preset = savedPresets.find((entry) => entry.id === id);
                      if (preset) {
                        setPresetShared(preset.isShared);
                        setPresetName(preset.name);
                        setPresetScope(preset.scope);
                        setPresetFolder(preset.folder);
                        setPresetReadOnly(preset.isReadOnly);
                        void fetchPresetHistory(preset.id);
                      } else {
                        setPresetHistory([]);
                      }
                    }}
                    className="flex-1 rounded-xl border border-slate-300 px-2 py-1.5 text-xs"
                  >
                    <option value="">Select preset</option>
                    {savedPresets.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        [{preset.folder}] {preset.name} · {preset.scope}
                        {preset.isReadOnly ? " · read-only" : ""}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => applyPreset(selectedPresetId)}
                    disabled={!selectedPresetId}
                    className="rounded-xl border border-slate-300 px-2 py-1.5 text-xs"
                  >
                    Apply
                  </button>
                  <button
                    type="button"
                    onClick={cloneSelectedPreset}
                    disabled={
                      !selectedPresetId ||
                      !savedPresets.find((entry) => entry.id === selectedPresetId)?.canClone
                    }
                    className="rounded-xl border border-blue-300 px-2 py-1.5 text-xs text-blue-700"
                  >
                    Clone
                  </button>
                  <button
                    type="button"
                    onClick={deleteSelectedPreset}
                    disabled={
                      !selectedPresetId ||
                      !savedPresets.find((entry) => entry.id === selectedPresetId)?.canDelete
                    }
                    className="rounded-xl border border-rose-300 px-2 py-1.5 text-xs text-rose-700"
                  >
                    Delete
                  </button>
                </div>
                <label className="flex items-center gap-2 text-xs text-slate-700">
                  <input
                    type="checkbox"
                    checked={presetShared}
                    onChange={(event) => setPresetShared(event.target.checked)}
                  />
                  Shared preset (visible to photographers/editors)
                </label>
                <label className="flex items-center gap-2 text-xs text-slate-700">
                  <span>Scope</span>
                  <select
                    value={presetScope}
                    onChange={(event) =>
                      setPresetScope(event.target.value as "personal" | "team")
                    }
                    className="rounded border border-slate-300 px-1.5 py-1 text-xs"
                  >
                    <option value="team">team</option>
                    <option value="personal">personal</option>
                  </select>
                </label>
                {role === "ADMIN" ? (
                  <label className="flex items-center gap-2 text-xs text-slate-700">
                    <input
                      type="checkbox"
                      checked={presetReadOnly}
                      onChange={(event) => setPresetReadOnly(event.target.checked)}
                    />
                    Editor-approved read-only
                  </label>
                ) : null}
              </div>
              {selectedPresetId ? (
                <div className="mt-2 rounded-xl border border-slate-200 bg-white p-2">
                  <p className="text-[11px] font-semibold text-slate-700">Preset audit history</p>
                  {presetHistory.length === 0 ? (
                    <p className="mt-1 text-[11px] text-slate-500">No history entries yet.</p>
                  ) : (
                    <ul className="mt-1 space-y-1 text-[11px] text-slate-600">
                      {presetHistory.slice(0, 5).map((entry) => (
                        <li key={entry.id}>
                          {entry.action} by {entry.actor?.name || entry.actor?.email || "unknown"} ·{" "}
                          {new Date(entry.createdAt).toLocaleString()}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : null}
              {selectedPreset ? (
                <div className="mt-2 rounded-xl border border-slate-200 bg-white p-2">
                  <p className="text-[11px] font-semibold text-slate-700">Preset compare preview</p>
                  {presetDiffRows.length === 0 ? (
                    <p className="mt-1 text-[11px] text-slate-500">
                      Current defaults match selected preset.
                    </p>
                  ) : (
                    <ul className="mt-1 space-y-1 text-[11px] text-slate-600">
                      {presetDiffRows.map((row) => (
                        <li key={row.label}>
                          {row.label}: preset <span className="font-semibold">{row.preset}</span> vs
                          current <span className="font-semibold">{row.current}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : null}
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                <input
                  value={batchDefaults.eventName}
                  onChange={(event) =>
                    setBatchDefaults((current) => ({ ...current, eventName: event.target.value }))
                  }
                  placeholder="Default event name (for queue submit)"
                  className="rounded-xl border border-slate-300 px-2 py-1.5 text-xs"
                />
                <input
                  value={batchDefaults.location}
                  onChange={(event) =>
                    setBatchDefaults((current) => ({ ...current, location: event.target.value }))
                  }
                  placeholder="Default location"
                  className="rounded-xl border border-slate-300 px-2 py-1.5 text-xs"
                />
                <input
                  value={batchDefaults.priceUsd}
                  onChange={(event) =>
                    setBatchDefaults((current) => ({ ...current, priceUsd: event.target.value }))
                  }
                  type="number"
                  min={1}
                  placeholder="Default price USD"
                  className="rounded-xl border border-slate-300 px-2 py-1.5 text-xs"
                />
                <select
                  value={batchDefaults.usageRights}
                  onChange={(event) =>
                    setBatchDefaults((current) => ({
                      ...current,
                      usageRights: event.target.value as UploadFormValues["usageRights"],
                    }))
                  }
                  className="rounded-xl border border-slate-300 px-2 py-1.5 text-xs"
                >
                  <option value="editorial">Default rights: editorial</option>
                  <option value="commercial">Default rights: commercial</option>
                </select>
                <input
                  value={batchDefaults.tags}
                  onChange={(event) =>
                    setBatchDefaults((current) => ({ ...current, tags: event.target.value }))
                  }
                  placeholder="Default tags"
                  className="rounded-xl border border-slate-300 px-2 py-1.5 text-xs md:col-span-2"
                />
              </div>
              <label className="mt-1 flex items-center gap-2 text-xs text-slate-700">
                <input
                  type="checkbox"
                  checked={batchIncludeCloud}
                  onChange={(event) => setBatchIncludeCloud(event.target.checked)}
                />
                Include cloud multipart full-res upload for each item
              </label>
              <label className="mt-1 flex items-center gap-2 text-xs text-slate-700">
                <input
                  type="checkbox"
                  checked={batchAutoSubmit}
                  onChange={(event) => setBatchAutoSubmit(event.target.checked)}
                />
                Auto-submit catalog records after processing
              </label>
              <label className="mt-1 flex items-center gap-2 text-xs text-slate-700">
                <input
                  type="checkbox"
                  checked={batchAutoApplySubjectMatches}
                  onChange={(event) => setBatchAutoApplySubjectMatches(event.target.checked)}
                />
                Auto-apply subject matches (slates/cards + match later photos without a board using people
                you already named for this event)
              </label>
              <button
                type="button"
                onClick={() => void runBatchAutomation()}
                disabled={isBatchRunning || (role !== "PHOTOGRAPHER" && role !== "ADMIN")}
                className="mt-2 rounded-xl bg-emerald-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
              >
                {isBatchRunning
                  ? isBatchSubmitting
                    ? "Submitting records..."
                    : "Running autopilot..."
                  : batchAutoSubmit
                    ? "Auto-process + submit queue"
                    : "Auto-process entire queue"}
              </button>
            </div>
          ) : null}
          {activeQueueItem ? (
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => void handleAutoUpload(activeQueueItem)}
                disabled={
                  isAutoUploading ||
                  !activeQueueItem.filenameValid ||
                  activeQueueItem.mediaKind !== "image" ||
                  (role !== "PHOTOGRAPHER" && role !== "ADMIN")
                }
                className="rounded-xl bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
              >
                {isAutoUploading ? "Auto-processing..." : "Run local automation on selected"}
              </button>
            </div>
          ) : null}
          {isAutoUploading ? <p className="mt-2 text-xs text-slate-600">Processing image...</p> : null}
          {latestAiSuggestion ? (
            <div className="mt-3 rounded-xl border border-blue-200 bg-blue-50 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold text-blue-900">
                  AI draft suggestions ({latestAiSuggestion.source}, metadata confidence{" "}
                  {Math.round(latestAiSuggestion.confidence * 100)}%)
                </p>
                {latestAiSuggestion.voiceTranscript ? (
                  <span className="rounded-full bg-emerald-100 px-2 py-1 text-[11px] font-semibold text-emerald-800">
                    AI title from voice note
                  </span>
                ) : null}
                {latestAiSuggestion.subjectName ? (
                  <span className="rounded-full bg-fuchsia-100 px-2 py-1 text-[11px] font-semibold text-fuchsia-800">
                    Subject detected: {latestAiSuggestion.subjectName}
                  </span>
                ) : null}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={applyLatestAiToForm}
                    disabled={applyToFormClicked}
                    aria-label={
                      applyToFormClicked
                        ? "AI suggestions already applied to the form"
                        : "Copy AI draft suggestions into the form fields"
                    }
                    className={`rounded-lg px-2.5 py-1 text-xs font-semibold text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-default disabled:opacity-100 ${
                      applyToFormClicked
                        ? "bg-emerald-600"
                        : "bg-blue-700 hover:bg-blue-800 active:bg-blue-900"
                    }`}
                  >
                    {applyToFormClicked ? "Applied to form" : "Apply to form"}
                  </button>
                  <button
                    type="button"
                    onClick={applyLatestAiToBatchDefaults}
                    className="rounded-lg border border-blue-300 bg-white px-2.5 py-1 text-xs font-semibold text-blue-900"
                  >
                    Apply to defaults
                  </button>
                </div>
              </div>
              {latestAiSuggestion.captionDraft ? (
                <p className="mt-2 text-xs text-blue-900">{latestAiSuggestion.captionDraft}</p>
              ) : null}
              {latestAiSuggestion.voiceTranscript ? (
                <p className="mt-2 text-[11px] text-emerald-800">
                  Voice transcript: &quot;
                  {latestAiSuggestion.voiceTranscript.slice(0, 140)}
                  {latestAiSuggestion.voiceTranscript.length > 140 ? "..." : ""}
                  &quot;
                </p>
              ) : null}
              <div className="mt-2 rounded-lg border border-blue-200 bg-white/70 p-2 text-[11px] text-blue-900">
                <p>
                  Voice note matched:{" "}
                  <span className="font-semibold">
                    {latestAiSuggestion.voiceNoteMatched ? "yes" : "no"}
                  </span>
                </p>
                <p>
                  Transcript status:{" "}
                  <span className="font-semibold">
                    {voiceTranscriptStatusLabel(latestAiSuggestion.voiceTranscriptStatus)}
                  </span>
                  {latestAiSuggestion.voiceTranscriptMessage
                    ? ` (${latestAiSuggestion.voiceTranscriptMessage})`
                    : ""}
                </p>
                <p>
                  Extracted title/name from WAV:{" "}
                  <span className="font-semibold">
                    {latestAiSuggestion.voiceTitleCandidate || "(none)"}
                  </span>
                </p>
                <p>
                  Applied to title:{" "}
                  <span className="font-semibold">
                    {latestAiSuggestion.voiceTitleApplied ? "yes" : "no"}
                  </span>
                </p>
              </div>
              <div className="mt-2 rounded-lg border border-fuchsia-200 bg-white/70 p-2 text-[11px] text-fuchsia-900">
                <p>
                  Slate/card detected:{" "}
                  <span className="font-semibold">
                    {latestAiSuggestion.slateDetected ? "yes" : "no"}
                  </span>
                </p>
                <p>
                  Candidate name:{" "}
                  <span className="font-semibold">
                    {latestAiSuggestion.slateCandidateName || "(none)"}
                  </span>
                </p>
                <p>
                  Confidence:{" "}
                  <span className="font-semibold">
                    {Math.round((latestAiSuggestion.slateConfidence || 0) * 100)}%
                  </span>
                </p>
                <p>
                  OCR pass:{" "}
                  <span className="font-semibold">
                    {slateDetectionPassLabel(latestAiSuggestion.slateDetectionPass)}
                  </span>
                </p>
                <p>
                  Model used:{" "}
                  <span className="font-semibold">
                    {latestAiSuggestion.slateModelUsed || "(none)"}
                  </span>
                </p>
                <p>
                  Fallback attempted:{" "}
                  <span className="font-semibold">
                    {latestAiSuggestion.slateFallbackAttempted ? "yes" : "no"}
                  </span>
                </p>
                <p>
                  Applied to title:{" "}
                  <span className="font-semibold">
                    {latestAiSuggestion.slateApplied ? "yes" : "no"}
                  </span>
                </p>
                <p>
                  Catalog lane:{" "}
                  <span className="font-semibold">
                    {latestAiSuggestion.subjectNamingStatus === "needs_manual"
                      ? "needs manual name (Name queue)"
                      : latestAiSuggestion.subjectNamingStatus === "from_slate"
                        ? "auto from slate/card"
                        : latestAiSuggestion.subjectNamingStatus === "from_match"
                          ? "auto from prior subject photo"
                          : "not classified"}
                  </span>
                  . Earlier no-slate frames may auto-rename when a later slate identifies that person.
                </p>
                <p>{latestAiSuggestion.slateMessage || "Slate/card OCR status unavailable."}</p>
                {latestAiSuggestion.slatePasses.length > 0 ? (
                  <div className="mt-1 rounded border border-fuchsia-100 bg-white/70 p-1.5">
                    <p className="font-semibold">Pass diagnostics</p>
                    <p className="mb-1 text-[11px] text-fuchsia-900/80">
                      Click a detected name below to copy it into the title field.
                    </p>
                    {latestAiSuggestion.slatePasses.map((pass, idx) => {
                      const cleaned = pass.candidateName
                        ? sanitizeDiagnosticCandidateName(pass.candidateName)
                        : "";
                      const canUse = pass.detected && cleaned.length >= 3;
                      return (
                        <p key={`${pass.pass}-${pass.model}-${idx}`}>
                          {slateDetectionPassLabel(pass.pass)}: {pass.detected ? "detected" : "none"} ·{" "}
                          {Math.round((pass.confidence || 0) * 100)}% · {pass.model}
                          {pass.candidateName ? (
                            <>
                              {" · "}
                              {canUse ? (
                                <button
                                  type="button"
                                  className="text-left font-semibold text-fuchsia-900 underline decoration-fuchsia-400/80 hover:text-fuchsia-950"
                                  onClick={() => applyOcrPassNameToForm(pass.candidateName)}
                                >
                                  {pass.candidateName}
                                </button>
                              ) : (
                                <span>{pass.candidateName}</span>
                              )}
                              {cleaned && cleaned !== pass.candidateName ? (
                                <span className="text-fuchsia-800/70"> → {cleaned}</span>
                              ) : null}
                            </>
                          ) : null}
                        </p>
                      );
                    })}
                  </div>
                ) : null}
                {!latestAiSuggestion.slateDetected && activeQueueItem?.mediaKind === "image" ? (
                  <button
                    type="button"
                    onClick={() => {
                      setSlateSelectMode(true);
                      setSlateSelectBox(null);
                      setSlateSelectImageSize(null);
                      setManualSlateOcrStatus("idle");
                      setManualSlateOcrMessage("");
                    }}
                    className="mt-2 rounded-lg border border-fuchsia-400 bg-fuchsia-50 px-2 py-1.5 text-xs font-semibold text-fuchsia-800 hover:bg-fuchsia-100"
                  >
                    Select slate region (draw box)
                  </button>
                ) : null}
              </div>
              <p className="mt-2 text-[11px] text-blue-800">
                title: {latestAiSuggestion.title || "(none)"} | event:{" "}
                {latestAiSuggestion.eventName || "(none)"} | location:{" "}
                {latestAiSuggestion.location || "(none)"}
              </p>
              {latestAiSuggestion.subjectName ? (
                <p className="mt-1 text-[11px] text-fuchsia-800">
                  Subject match: {latestAiSuggestion.subjectName} ({latestAiSuggestion.subjectSource},{" "}
                  {Math.round(latestAiSuggestion.subjectConfidence * 100)}%)
                </p>
              ) : null}
            </div>
          ) : null}
          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-semibold text-slate-800">
              Optional: Direct cloud full-res multipart upload (S3/R2)
            </p>
            <p className="mt-1 text-xs text-slate-600">
              Uses signed part URLs and uploads straight from browser to cloud storage.
            </p>
            <button
              type="button"
              onClick={() => void handleCloudMultipartUpload()}
              disabled={
                isCloudUploading ||
                !activeQueueItem ||
                (role !== "PHOTOGRAPHER" && role !== "ADMIN")
              }
              className="mt-2 rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
            >
              {isCloudUploading ? `Uploading... ${cloudProgress}%` : "Upload full-res to cloud"}
            </button>
            {isCloudUploading ? (
              <div className="mt-2 h-2 w-full overflow-hidden rounded bg-slate-200">
                <div
                  className="h-full bg-emerald-600 transition-all"
                  style={{ width: `${cloudProgress}%` }}
                />
              </div>
            ) : null}
          </div>

        {role !== "PHOTOGRAPHER" && role !== "ADMIN" ? (
          <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            Photographer/admin login required to submit uploads.{" "}
            <Link href="/login?next=/upload" className="underline">
              Sign in
            </Link>
          </div>
        ) : null}
        <form className="grid gap-3 md:grid-cols-2" onSubmit={handleSubmit}>
          <input
            required
            name="title"
            value={values.title}
            onChange={(event) => setValue("title", event.target.value)}
            placeholder="Image title"
            className={`rounded-xl border border-slate-300 px-3 py-2 text-sm ${aiFieldClass("title")}`}
          />
          <input
            required
            name="photographer"
            value={values.photographer}
            onChange={(event) => setValue("photographer", event.target.value)}
            placeholder="Photographer name"
            className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            required
            name="eventName"
            value={values.eventName}
            onChange={(event) => setValue("eventName", event.target.value)}
            placeholder="Event name"
            className={`rounded-xl border border-slate-300 px-3 py-2 text-sm ${aiFieldClass("eventName")}`}
          />
          <input
            required
            name="location"
            value={values.location}
            onChange={(event) => setValue("location", event.target.value)}
            placeholder="Location (City, State)"
            className={`rounded-xl border border-slate-300 px-3 py-2 text-sm ${aiFieldClass("location")}`}
          />
          <input
            required
            name="eventSlug"
            value={values.eventSlug}
            onChange={(event) => setValue("eventSlug", event.target.value)}
            placeholder="Event slug (e.g., city-marathon-2026)"
            className={`rounded-xl border border-slate-300 px-3 py-2 text-sm ${aiFieldClass("eventSlug")}`}
          />
          <input
            required
            name="capturedAt"
            type="datetime-local"
            value={values.capturedAt}
            onChange={(event) => setValue("capturedAt", event.target.value)}
            className={`rounded-xl border border-slate-300 px-3 py-2 text-sm ${aiFieldClass("capturedAt")}`}
          />
          <input
            required
            name="priceUsd"
            type="number"
            min={1}
            value={values.priceUsd}
            onChange={(event) => setValue("priceUsd", event.target.value)}
            placeholder="License price (USD)"
            className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
          />
          <select
            required
            name="usageRights"
            className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
            value={values.usageRights}
            onChange={(event) =>
              setValue("usageRights", event.target.value as UploadFormValues["usageRights"])
            }
          >
            <option value="editorial">Editorial</option>
            <option value="commercial">Commercial</option>
          </select>
          <input
            required
            name="filename"
            value={values.filename}
            onChange={(event) => setValue("filename", event.target.value)}
            placeholder="Well-named filename"
            readOnly={Boolean(activeQueueFilename)}
            className={`rounded-xl border border-slate-300 px-3 py-2 text-sm md:col-span-2 ${
              activeQueueFilename ? "bg-slate-100 text-slate-600" : ""
            }`}
          />
          {activeQueueFilename ? (
            <p className="-mt-1 text-xs text-slate-500 md:col-span-2">
              Filename is locked to the selected queued file to preserve naming validation.
            </p>
          ) : null}
          <input
            name="previewUrl"
            value={values.previewUrl}
            onChange={(event) => setValue("previewUrl", event.target.value)}
            placeholder="Preview image URL (optional)"
            className="rounded-xl border border-slate-300 px-3 py-2 text-sm md:col-span-2"
          />
          <input
            name="fullResUrl"
            value={values.fullResUrl}
            onChange={(event) => setValue("fullResUrl", event.target.value)}
            placeholder="Full-resolution delivery URL (optional)"
            className="rounded-xl border border-slate-300 px-3 py-2 text-sm md:col-span-2"
          />
          <input
            name="storageKey"
            value={values.storageKey}
            onChange={(event) => setValue("storageKey", event.target.value)}
            placeholder="Storage key (S3/R2 object path, optional)"
            className="rounded-xl border border-slate-300 px-3 py-2 text-sm md:col-span-2"
          />
          <textarea
            name="tags"
            value={values.tags}
            onChange={(event) => setValue("tags", event.target.value)}
            placeholder="Comma-separated tags (e.g., red-carpet, keynote, finish-line)"
            className={`rounded-xl border border-slate-300 px-3 py-2 text-sm md:col-span-2 ${aiFieldClass("tags")}`}
            rows={3}
          />
          <textarea
            name="attendeeKeywords"
            value={values.attendeeKeywords}
            onChange={(event) => setValue("attendeeKeywords", event.target.value)}
            placeholder="Attendee-friendly keywords (e.g., bib-4481, table-a3, guest-lastname)"
            className={`rounded-xl border border-slate-300 px-3 py-2 text-sm md:col-span-2 ${aiFieldClass("attendeeKeywords")}`}
            rows={2}
          />
          <button
            type="submit"
            disabled={isSubmitting || (role !== "PHOTOGRAPHER" && role !== "ADMIN")}
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-60 md:col-span-2"
          >
            {isSubmitting ? "Submitting..." : "Submit Catalog Record"}
          </button>
        </form>
      </section>

      <section className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-700">
        <p className="font-semibold">Naming pattern recommendation</p>
        <p className="mt-1">
          <code>YYYY-MM-DD_event-slug_subject_photographerinitials_sequence.ext</code>
        </p>
      </section>

      {status ? (
        <p
          className={`rounded-xl p-3 text-sm ${
            status.ok
              ? "border border-emerald-300 bg-emerald-50 text-emerald-800"
              : "border border-red-300 bg-red-50 text-red-800"
          }`}
        >
          {status.message}
        </p>
      ) : null}

      {slateSelectMode && activeQueueItem?.mediaKind === "image" ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Select slate region"
        >
          <div className="flex max-h-[90vh] max-w-4xl flex-col rounded-xl border border-slate-300 bg-white p-3 shadow-xl">
            <p className="mb-2 text-sm font-semibold text-slate-800">
              Draw a box around the name slate, then run OCR
            </p>
            <p className="mb-2 text-xs text-slate-500">
              First run can take 30–60 seconds while the OCR engine loads.
            </p>
            <div className="relative inline-block max-w-full self-center">
              <img
                ref={slateSelectImgRef}
                src={activeQueueItem.objectUrl}
                alt="Select region"
                className="block max-h-[70vh] max-w-full select-none"
                draggable={false}
                onLoad={() => {
                  const img = slateSelectImgRef.current;
                  if (!img) return;
                  const rect = img.getBoundingClientRect();
                  setSlateSelectImageSize({
                    displayW: rect.width,
                    displayH: rect.height,
                    naturalW: img.naturalWidth,
                    naturalH: img.naturalHeight,
                  });
                }}
              />
              <div
                ref={slateSelectOverlayRef}
                className="absolute inset-0 cursor-crosshair"
                onMouseDown={(e) => {
                  const el = slateSelectOverlayRef.current;
                  if (!el) return;
                  const rect = el.getBoundingClientRect();
                  const x = e.clientX - rect.left;
                  const y = e.clientY - rect.top;
                  slateSelectDragRef.current = { startX: x, startY: y };
                  setSlateSelectBox({ x, y, w: 0, h: 0 });
                }}
                onMouseMove={(e) => {
                  if (!slateSelectDragRef.current) return;
                  const el = slateSelectOverlayRef.current;
                  if (!el) return;
                  const rect = el.getBoundingClientRect();
                  const x = e.clientX - rect.left;
                  const y = e.clientY - rect.top;
                  const { startX, startY } = slateSelectDragRef.current;
                  const minX = Math.max(0, Math.min(startX, x));
                  const minY = Math.max(0, Math.min(startY, y));
                  const maxX = Math.min(rect.width, Math.max(startX, x));
                  const maxY = Math.min(rect.height, Math.max(startY, y));
                  setSlateSelectBox({
                    x: minX,
                    y: minY,
                    w: maxX - minX,
                    h: maxY - minY,
                  });
                }}
                onMouseUp={() => {
                  slateSelectDragRef.current = null;
                }}
                onMouseLeave={() => {
                  slateSelectDragRef.current = null;
                }}
              />
              {slateSelectBox && slateSelectBox.w > 0 && slateSelectBox.h > 0 ? (
                <div
                  className="pointer-events-none absolute border-2 border-blue-500 bg-blue-500/20"
                  style={{
                    left: slateSelectBox.x,
                    top: slateSelectBox.y,
                    width: slateSelectBox.w,
                    height: slateSelectBox.h,
                  }}
                />
              ) : null}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void runManualSlateOcr()}
                disabled={manualSlateOcrStatus === "loading" || !slateSelectBox || slateSelectBox.w < 10 || slateSelectBox.h < 10}
                className="rounded-lg bg-fuchsia-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-fuchsia-700 disabled:opacity-50"
              >
                {manualSlateOcrStatus === "loading" ? "Running OCR…" : "Run OCR on selection"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setSlateSelectMode(false);
                  setSlateSelectBox(null);
                  setSlateSelectImageSize(null);
                  setManualSlateOcrStatus("idle");
                  setManualSlateOcrMessage("");
                }}
                className="rounded-lg border border-slate-400 bg-slate-100 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-200"
              >
                Cancel
              </button>
              {manualSlateOcrMessage ? (
                <span
                  className={`text-sm ${
                    manualSlateOcrStatus === "error" ? "text-red-600" : "text-slate-700"
                  }`}
                >
                  {manualSlateOcrMessage}
                </span>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
