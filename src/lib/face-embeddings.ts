/**
 * Face embedding re-ID: numeric descriptors + cosine / Euclidean match.
 *
 * Backends (first available wins for gallery compare):
 * 1. Amazon Rekognition CompareFaces — when AWS keys are configured
 * 2. Local FaceNet-style descriptors via @vladmandic/face-api (WASM) — no extra keys
 *
 * LLM vision match remains a fallback in upload-ai when embeddings are inconclusive.
 */
import path from "node:path";
import { createRequire } from "node:module";
import sharp from "sharp";
import {
  CompareFacesCommand,
  RekognitionClient,
} from "@aws-sdk/client-rekognition";

export const FACE_EMBEDDING_DIM = 128;

/** Max Euclidean distance (FaceNet) to accept a local match. Lower = stricter. */
const DEFAULT_LOCAL_MAX_DISTANCE = 0.55;
/** Min Rekognition similarity (0–100) to accept a match. */
const DEFAULT_REKOGNITION_MIN_SIMILARITY = 90;

export type FaceEmbeddingMatch = {
  subjectName: string;
  confidence: number;
  distance?: number;
  similarity?: number;
  backend: "local" | "rekognition";
};

// WASM build typings omit tf helpers; keep a narrow runtime shape.
type FaceApiRuntime = {
  tf: {
    setBackend: (backend: string) => Promise<boolean> | boolean;
    ready: () => Promise<void>;
    tensor3d: (
      values: Uint8Array,
      shape: [number, number, number],
    ) => { dispose: () => void };
  };
  nets: {
    tinyFaceDetector: { loadFromDisk: (dir: string) => Promise<void> };
    faceLandmark68TinyNet: { loadFromDisk: (dir: string) => Promise<void> };
    faceRecognitionNet: {
      loadFromDisk: (dir: string) => Promise<void>;
      computeFaceDescriptor: (input: unknown) => Promise<Float32Array>;
    };
  };
  TinyFaceDetectorOptions: new (opts: {
    inputSize?: number;
    scoreThreshold?: number;
  }) => unknown;
  detectSingleFace: (
    input: unknown,
    options?: unknown,
  ) => {
    withFaceLandmarks: (useTiny?: boolean) => {
      withFaceDescriptor: () => Promise<{ descriptor: Float32Array } | undefined>;
    };
  };
};

let faceApiPromise: Promise<FaceApiRuntime> | null = null;
let modelsLoaded = false;

function dataUrlToBuffer(dataUrl: string): Buffer | null {
  const marker = "base64,";
  const i = dataUrl.indexOf(marker);
  if (i === -1) return null;
  const payload = dataUrl.slice(i + marker.length);
  if (!payload) return null;
  return Buffer.from(payload, "base64");
}

function imageToBuffer(image: Buffer | string): Buffer | null {
  if (Buffer.isBuffer(image)) return image;
  const trimmed = image.trim();
  if (trimmed.startsWith("data:image/")) return dataUrlToBuffer(trimmed);
  try {
    return Buffer.from(trimmed, "base64");
  } catch {
    return null;
  }
}

function l2Normalize(vec: number[]): number[] {
  let sum = 0;
  for (const v of vec) sum += v * v;
  const norm = Math.sqrt(sum);
  if (!Number.isFinite(norm) || norm < 1e-8) return vec;
  return vec.map((v) => v / norm);
}

/** Euclidean distance between two equal-length vectors. */
export function embeddingDistance(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return Number.POSITIVE_INFINITY;
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i]! - b[i]!;
    sum += d * d;
  }
  return Math.sqrt(sum);
}

export function parseFaceEmbedding(raw: unknown): number[] | undefined {
  if (!Array.isArray(raw) || raw.length < 32) return undefined;
  const nums = raw.map((v) => Number(v));
  if (nums.some((n) => !Number.isFinite(n))) return undefined;
  return nums;
}

export function getLocalMaxDistance(): number {
  const raw = process.env.FACE_EMBEDDING_MAX_DISTANCE?.trim() ?? "";
  const n = Number.parseFloat(raw);
  if (Number.isFinite(n) && n >= 0.3 && n <= 0.8) return n;
  return DEFAULT_LOCAL_MAX_DISTANCE;
}

export function getRekognitionMinSimilarity(): number {
  const raw = process.env.FACE_REKOGNITION_MIN_SIMILARITY?.trim() ?? "";
  const n = Number.parseFloat(raw);
  if (Number.isFinite(n) && n >= 70 && n <= 99) return n;
  return DEFAULT_REKOGNITION_MIN_SIMILARITY;
}

function faceMatchProvider(): "auto" | "local" | "rekognition" | "off" {
  const v = (process.env.FACE_EMBEDDING_PROVIDER || "auto").trim().toLowerCase();
  if (v === "local" || v === "rekognition" || v === "off" || v === "auto") return v;
  return "auto";
}

export function isRekognitionConfigured(): boolean {
  const dedicatedKey = process.env.REKOGNITION_ACCESS_KEY_ID?.trim();
  const dedicatedSecret = process.env.REKOGNITION_SECRET_ACCESS_KEY?.trim();
  if (dedicatedKey && dedicatedSecret) return true;

  // Reuse S3 keys only when talking to real AWS (no custom R2/MinIO endpoint).
  const endpoint = process.env.S3_ENDPOINT?.trim();
  if (endpoint) return false;
  const key = process.env.S3_ACCESS_KEY_ID?.trim();
  const secret = process.env.S3_SECRET_ACCESS_KEY?.trim();
  return Boolean(key && secret);
}

function getRekognitionClient(): RekognitionClient | null {
  if (!isRekognitionConfigured()) return null;
  const accessKeyId =
    process.env.REKOGNITION_ACCESS_KEY_ID?.trim() ||
    process.env.S3_ACCESS_KEY_ID?.trim() ||
    "";
  const secretAccessKey =
    process.env.REKOGNITION_SECRET_ACCESS_KEY?.trim() ||
    process.env.S3_SECRET_ACCESS_KEY?.trim() ||
    "";
  const region =
    process.env.REKOGNITION_REGION?.trim() ||
    process.env.S3_REGION?.trim() ||
    "us-east-1";
  if (!accessKeyId || !secretAccessKey) return null;
  return new RekognitionClient({
    region,
    credentials: { accessKeyId, secretAccessKey },
  });
}

async function loadFaceApi(): Promise<FaceApiRuntime> {
  if (!faceApiPromise) {
    faceApiPromise = (async () => {
      const faceapi = (await import(
        "@vladmandic/face-api/dist/face-api.node-wasm.js"
      )) as unknown as FaceApiRuntime;
      await faceapi.tf.setBackend("wasm");
      await faceapi.tf.ready();
      if (!modelsLoaded) {
        const require = createRequire(path.join(process.cwd(), "package.json"));
        const pkgDir = path.dirname(require.resolve("@vladmandic/face-api/package.json"));
        const modelPath = path.join(pkgDir, "model");
        await Promise.all([
          faceapi.nets.tinyFaceDetector.loadFromDisk(modelPath),
          faceapi.nets.faceLandmark68TinyNet.loadFromDisk(modelPath),
          faceapi.nets.faceRecognitionNet.loadFromDisk(modelPath),
        ]);
        modelsLoaded = true;
      }
      return faceapi;
    })().catch((err) => {
      faceApiPromise = null;
      throw err;
    });
  }
  return faceApiPromise;
}

/**
 * Compute a 128-d face descriptor from a face crop (or full frame).
 * Prefers detector+landmarks alignment; falls back to 150×150 direct descriptor.
 */
export async function computeFaceEmbedding(
  image: Buffer | string,
): Promise<number[] | undefined> {
  const provider = faceMatchProvider();
  if (provider === "off" || provider === "rekognition") return undefined;

  try {
    const inputBytes = imageToBuffer(image);
    if (!inputBytes || inputBytes.length < 32) return undefined;

    const faceapi = await loadFaceApi();
    const { data, info } = await sharp(inputBytes)
      .rotate()
      .removeAlpha()
      .resize({
        width: 320,
        height: 320,
        fit: "inside",
        withoutEnlargement: false,
      })
      .raw()
      .toBuffer({ resolveWithObject: true });

    const tensor = faceapi.tf.tensor3d(new Uint8Array(data), [
      info.height,
      info.width,
      3,
    ]);

    try {
      const options = new faceapi.TinyFaceDetectorOptions({
        inputSize: 224,
        scoreThreshold: 0.2,
      });
      const detected = await faceapi
        .detectSingleFace(tensor, options)
        .withFaceLandmarks(true)
        .withFaceDescriptor();

      if (detected?.descriptor && detected.descriptor.length >= 32) {
        return l2Normalize(Array.from(detected.descriptor));
      }
    } finally {
      tensor.dispose();
    }

    // Fallback: Vision crops are already face-centered — run recognition net directly.
    const { data: raw150, info: info150 } = await sharp(inputBytes)
      .rotate()
      .removeAlpha()
      .resize(150, 150, { fit: "cover" })
      .raw()
      .toBuffer({ resolveWithObject: true });

    const t150 = faceapi.tf.tensor3d(new Uint8Array(raw150), [
      info150.height,
      info150.width,
      3,
    ]);
    try {
      const desc = await faceapi.nets.faceRecognitionNet.computeFaceDescriptor(t150);
      const arr = Array.from(desc as Float32Array);
      if (arr.length < 32) return undefined;
      return l2Normalize(arr);
    } finally {
      t150.dispose();
    }
  } catch (e) {
    console.warn("Local face embedding failed:", e);
    return undefined;
  }
}

function distanceToConfidence(distance: number, maxDistance: number): number {
  // distance 0 → ~0.98; at threshold → ~0.80
  const t = Math.max(0, Math.min(1, 1 - distance / maxDistance));
  return Math.max(0.8, Math.min(0.98, 0.8 + t * 0.18));
}

async function matchWithRekognition(args: {
  candidateFaceCrop: Buffer;
  knownSubjects: Array<{ name: string; faceCropDataUrl?: string }>;
}): Promise<FaceEmbeddingMatch | undefined> {
  const client = getRekognitionClient();
  if (!client) return undefined;

  const minSim = getRekognitionMinSimilarity();
  let best: FaceEmbeddingMatch | undefined;

  for (const subject of args.knownSubjects) {
    const refUrl = subject.faceCropDataUrl?.trim();
    if (!refUrl) continue;
    const refBuf = dataUrlToBuffer(refUrl);
    if (!refBuf || refBuf.length < 32) continue;

    try {
      const out = await client.send(
        new CompareFacesCommand({
          SourceImage: { Bytes: args.candidateFaceCrop },
          TargetImage: { Bytes: refBuf },
          SimilarityThreshold: Math.min(minSim, 80),
          QualityFilter: "AUTO",
        }),
      );
      const sim = out.FaceMatches?.[0]?.Similarity;
      if (typeof sim !== "number" || !Number.isFinite(sim)) continue;
      if (sim < minSim) continue;
      const confidence = Math.max(0.8, Math.min(0.99, sim / 100));
      if (!best || confidence > best.confidence) {
        best = {
          subjectName: subject.name,
          confidence,
          similarity: sim,
          backend: "rekognition",
        };
      }
    } catch (e) {
      console.warn(`Rekognition CompareFaces failed for ${subject.name}:`, e);
    }
  }

  return best;
}

async function matchWithLocalEmbeddings(args: {
  candidateEmbedding: number[];
  knownSubjects: Array<{ name: string; faceEmbedding?: number[]; faceCropDataUrl?: string }>;
}): Promise<FaceEmbeddingMatch | undefined> {
  const maxDistance = getLocalMaxDistance();
  let best: FaceEmbeddingMatch | undefined;

  for (const subject of args.knownSubjects) {
    let emb = parseFaceEmbedding(subject.faceEmbedding);
    if (!emb && subject.faceCropDataUrl) {
      emb = await computeFaceEmbedding(subject.faceCropDataUrl);
    }
    if (!emb) continue;

    const distance = embeddingDistance(args.candidateEmbedding, emb);
    if (distance > maxDistance) continue;
    const confidence = distanceToConfidence(distance, maxDistance);
    if (!best || distance < (best.distance ?? Number.POSITIVE_INFINITY)) {
      best = {
        subjectName: subject.name,
        confidence,
        distance,
        backend: "local",
      };
    }
  }

  return best;
}

/**
 * Match a candidate face against known event subjects using embeddings / Rekognition.
 */
export async function matchFaceAgainstKnown(args: {
  /** Preferred: tight face crop of the new photo. */
  faceCropDataUrl?: string;
  /** Full frame fallback when no crop. */
  imageDataUrl?: string;
  knownSubjects: Array<{
    name: string;
    faceCropDataUrl?: string;
    faceEmbedding?: number[];
  }>;
}): Promise<FaceEmbeddingMatch | undefined> {
  const provider = faceMatchProvider();
  if (provider === "off") return undefined;
  if (args.knownSubjects.length === 0) return undefined;

  const faceSource =
    args.faceCropDataUrl?.trim() ||
    args.imageDataUrl?.trim() ||
    "";
  if (!faceSource) return undefined;

  const candidateBuf = imageToBuffer(faceSource);
  if (!candidateBuf) return undefined;

  const withFaces = args.knownSubjects.filter(
    (s) => s.faceCropDataUrl?.trim() || parseFaceEmbedding(s.faceEmbedding),
  );
  if (withFaces.length === 0) return undefined;

  const wantRekognition = provider === "rekognition" || provider === "auto";
  const wantLocal = provider === "local" || provider === "auto";

  if (wantRekognition && isRekognitionConfigured()) {
    const rek = await matchWithRekognition({
      candidateFaceCrop: candidateBuf,
      knownSubjects: withFaces,
    });
    if (rek) return rek;
    if (provider === "rekognition") return undefined;
  }

  if (wantLocal) {
    const candidateEmbedding = await computeFaceEmbedding(candidateBuf);
    if (!candidateEmbedding) return undefined;
    return matchWithLocalEmbeddings({
      candidateEmbedding,
      knownSubjects: withFaces,
    });
  }

  return undefined;
}

export function isLocalFaceEmbeddingConfigured(): boolean {
  const provider = faceMatchProvider();
  return provider === "auto" || provider === "local";
}
