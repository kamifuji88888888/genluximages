/**
 * Pure helpers (no sharp/db) for slate auto-naming quality:
 *  - correctNameAgainstRoster: snap an OCR read to an existing event attendee when it is an
 *    obvious mis-spelling (e.g. "Sean Jarnes" -> "Sean James").
 *  - computeSlateNameConsensus: combine independent signals (OCR passes, OpenAI card read,
 *    visual re-ID match, event roster) into an agreement count + confidence boost, so we can
 *    auto-apply confident names and route ambiguous ones to the manual Name queue.
 */

/** Lowercase, strip punctuation, collapse whitespace — for comparing names across sources. */
export function normalizeNameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Classic Levenshtein edit distance. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) prev[j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j += 1) prev[j] = curr[j];
  }
  return prev[b.length];
}

export type RosterCorrection = {
  /** Corrected (or original) display name. */
  name: string;
  /** True when name exactly matches a roster entry (after normalization or near-correction). */
  matched: boolean;
  /** True when we changed the spelling to a roster entry. */
  corrected: boolean;
  /** Roster display name we snapped to, if any. */
  rosterName?: string;
  distance: number;
};

/**
 * Only snap to a roster name when the read is an obvious typo of an existing attendee:
 * conservative thresholds so we do not merge two genuinely different people.
 */
export function correctNameAgainstRoster(
  candidate: string,
  rosterNames: string[],
): RosterCorrection {
  const trimmed = candidate.trim();
  if (!trimmed || rosterNames.length === 0) {
    return { name: trimmed, matched: false, corrected: false, distance: Infinity };
  }
  const candKey = normalizeNameKey(trimmed);
  if (!candKey) {
    return { name: trimmed, matched: false, corrected: false, distance: Infinity };
  }

  let best: { rosterName: string; distance: number } | null = null;
  for (const rosterName of rosterNames) {
    const key = normalizeNameKey(rosterName);
    if (!key) continue;
    if (key === candKey) {
      return {
        name: rosterName,
        matched: true,
        corrected: rosterName.trim() !== trimmed,
        rosterName,
        distance: 0,
      };
    }
    const distance = levenshtein(candKey, key);
    if (!best || distance < best.distance) {
      best = { rosterName, distance };
    }
  }

  if (best) {
    const longer = Math.max(candKey.length, normalizeNameKey(best.rosterName).length);
    const acceptable =
      (best.distance <= 1 && longer >= 4) || (best.distance <= 2 && longer >= 6);
    if (acceptable) {
      return {
        name: best.rosterName,
        matched: true,
        corrected: true,
        rosterName: best.rosterName,
        distance: best.distance,
      };
    }
  }

  return { name: trimmed, matched: false, corrected: false, distance: best?.distance ?? Infinity };
}

export type ConsensusInput = {
  /** Chosen name after roster correction. */
  primaryName: string;
  /** Candidate names from individual OCR passes (may repeat). */
  ocrPassNames: string[];
  /** OpenAI card-detection name, if any. */
  cardName?: string;
  /** Visual re-ID match name, if any. */
  matchName?: string;
  /** Whether primaryName matched an event roster entry. */
  rosterMatched: boolean;
};

export type ConsensusResult = {
  /** Distinct source categories agreeing on primaryName (ocr / card / match / roster). */
  agreementCount: number;
  sources: string[];
  /** Confidence bump to add to the raw slate confidence (0–~0.35). */
  confidenceBoost: number;
  /** True when signals are strong enough to trust the name for auto-apply. */
  strong: boolean;
};

export function computeSlateNameConsensus(input: ConsensusInput): ConsensusResult {
  const key = normalizeNameKey(input.primaryName);
  const sources: string[] = [];
  if (!key) {
    return { agreementCount: 0, sources, confidenceBoost: 0, strong: false };
  }

  const ocrAgree = input.ocrPassNames.filter((n) => normalizeNameKey(n) === key).length;
  if (ocrAgree >= 1) sources.push(ocrAgree >= 2 ? `ocr x${ocrAgree}` : "ocr");
  const cardAgrees = Boolean(input.cardName && normalizeNameKey(input.cardName) === key);
  if (cardAgrees) sources.push("card");
  const matchAgrees = Boolean(input.matchName && normalizeNameKey(input.matchName) === key);
  if (matchAgrees) sources.push("face-match");
  if (input.rosterMatched) sources.push("event-roster");

  const agreementCount = sources.length;
  const multiOcr = ocrAgree >= 2;

  let confidenceBoost = 0;
  if (input.rosterMatched) confidenceBoost += 0.2;
  if (agreementCount >= 2) confidenceBoost += 0.12;
  if (cardAgrees && matchAgrees) confidenceBoost += 0.1;
  if (multiOcr) confidenceBoost += 0.05;
  confidenceBoost = Math.min(0.35, confidenceBoost);

  const strong = input.rosterMatched || agreementCount >= 2 || (matchAgrees && cardAgrees);

  return { agreementCount, sources, confidenceBoost, strong };
}
