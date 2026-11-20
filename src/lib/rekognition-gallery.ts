/**
 * Amazon Rekognition face collections for 1:N search within a photographer+event gallery.
 * ExternalImageId maps to subjectKey so SearchFacesByImage can resolve a display name.
 */
import {
  CreateCollectionCommand,
  DeleteFacesCommand,
  IndexFacesCommand,
  ListFacesCommand,
  RekognitionClient,
  ResourceAlreadyExistsException,
  SearchFacesByImageCommand,
} from "@aws-sdk/client-rekognition";

const DEFAULT_MIN_SIMILARITY = 90;

export function isRekognitionConfigured(): boolean {
  const dedicatedKey = process.env.REKOGNITION_ACCESS_KEY_ID?.trim();
  const dedicatedSecret = process.env.REKOGNITION_SECRET_ACCESS_KEY?.trim();
  if (dedicatedKey && dedicatedSecret) return true;
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

/** Rekognition CollectionId: [a-zA-Z0-9_.\-]+ max 255 */
export function rekognitionCollectionId(photographerId: string, eventSlug: string): string {
  const photo = photographerId.replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 40) || "p";
  const event =
    eventSlug
      .trim()
      .toLowerCase()
      .replace(/[^a-zA-Z0-9_.-]/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 80) || "general";
  return `genlux_${photo}_${event}`.slice(0, 255);
}

/** ExternalImageId: [a-zA-Z0-9_.\-:]+ */
export function rekognitionExternalImageId(subjectKey: string): string {
  return subjectKey
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9_.\-:]/g, "")
    .slice(0, 255);
}

function getMinSimilarity(): number {
  const raw = process.env.FACE_REKOGNITION_MIN_SIMILARITY?.trim() ?? "";
  const n = Number.parseFloat(raw);
  if (Number.isFinite(n) && n >= 70 && n <= 99) return n;
  return DEFAULT_MIN_SIMILARITY;
}

async function ensureCollection(client: RekognitionClient, collectionId: string): Promise<void> {
  try {
    await client.send(new CreateCollectionCommand({ CollectionId: collectionId }));
  } catch (e) {
    if (e instanceof ResourceAlreadyExistsException) return;
    const name = (e as { name?: string })?.name || "";
    if (name === "ResourceAlreadyExistsException") return;
    throw e;
  }
}

async function deleteFacesByExternalId(
  client: RekognitionClient,
  collectionId: string,
  externalImageId: string,
): Promise<void> {
  const faceIds: string[] = [];
  let nextToken: string | undefined;
  do {
    const listed = await client.send(
      new ListFacesCommand({
        CollectionId: collectionId,
        MaxResults: 100,
        NextToken: nextToken,
      }),
    );
    for (const face of listed.Faces || []) {
      if (face.ExternalImageId === externalImageId && face.FaceId) {
        faceIds.push(face.FaceId);
      }
    }
    nextToken = listed.NextToken;
  } while (nextToken);

  if (faceIds.length === 0) return;
  // Delete in chunks of 4096 (API max)
  for (let i = 0; i < faceIds.length; i += 100) {
    await client.send(
      new DeleteFacesCommand({
        CollectionId: collectionId,
        FaceIds: faceIds.slice(i, i + 100),
      }),
    );
  }
}

/**
 * Index a face crop into the event collection. Returns Rekognition FaceId when successful.
 */
export async function indexSubjectFaceInCollection(args: {
  photographerId: string;
  eventSlug: string;
  subjectKey: string;
  faceImage: Buffer;
}): Promise<string | undefined> {
  const client = getRekognitionClient();
  if (!client) return undefined;
  if (args.faceImage.byteLength < 32 || args.faceImage.byteLength > 15 * 1024 * 1024) {
    return undefined;
  }

  const collectionId = rekognitionCollectionId(args.photographerId, args.eventSlug);
  const externalImageId = rekognitionExternalImageId(args.subjectKey);
  if (!externalImageId) return undefined;

  try {
    await ensureCollection(client, collectionId);
    await deleteFacesByExternalId(client, collectionId, externalImageId);

    const indexed = await client.send(
      new IndexFacesCommand({
        CollectionId: collectionId,
        Image: { Bytes: args.faceImage },
        ExternalImageId: externalImageId,
        MaxFaces: 1,
        QualityFilter: "AUTO",
        DetectionAttributes: [],
      }),
    );
    const faceId = indexed.FaceRecords?.[0]?.Face?.FaceId;
    return faceId || undefined;
  } catch (e) {
    console.warn("Rekognition IndexFaces failed:", e);
    return undefined;
  }
}

export type RekognitionCollectionMatch = {
  externalImageId: string;
  similarity: number;
  faceId?: string;
};

/**
 * 1:N search in the photographer+event collection.
 */
export async function searchSubjectFaceInCollection(args: {
  photographerId: string;
  eventSlug: string;
  faceImage: Buffer;
}): Promise<RekognitionCollectionMatch | undefined> {
  const client = getRekognitionClient();
  if (!client) return undefined;
  if (args.faceImage.byteLength < 32) return undefined;

  const collectionId = rekognitionCollectionId(args.photographerId, args.eventSlug);
  const minSim = getMinSimilarity();

  try {
    const result = await client.send(
      new SearchFacesByImageCommand({
        CollectionId: collectionId,
        Image: { Bytes: args.faceImage },
        MaxFaces: 3,
        FaceMatchThreshold: minSim,
        QualityFilter: "AUTO",
      }),
    );
    const best = result.FaceMatches?.[0];
    const similarity = best?.Similarity;
    const externalImageId = best?.Face?.ExternalImageId?.trim();
    if (
      typeof similarity !== "number" ||
      !Number.isFinite(similarity) ||
      similarity < minSim ||
      !externalImageId
    ) {
      return undefined;
    }
    return {
      externalImageId,
      similarity,
      faceId: best?.Face?.FaceId,
    };
  } catch (e) {
    const name = (e as { name?: string })?.name || "";
    // Empty / missing collection is normal before first slate index
    if (name === "ResourceNotFoundException") return undefined;
    console.warn("Rekognition SearchFacesByImage failed:", e);
    return undefined;
  }
}
