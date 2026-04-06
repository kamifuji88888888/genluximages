/** Strip trailing junk tokens Vision appends to board lines (Url, Brands, etc.). Safe for client + server. */
export function sanitizeDiagnosticCandidateName(raw: string): string {
  let s = raw.trim().replace(/\s+/g, " ");
  for (let i = 0; i < 3; i += 1) {
    const next = s.replace(
      /\s+(Url|Urls|Brand|Brands|Inc|LLC|Com|Www|Mag|Issue|Online|Shop|Store)\.?$/i,
      "",
    ).trim();
    if (next === s) break;
    s = next;
  }
  return s;
}
