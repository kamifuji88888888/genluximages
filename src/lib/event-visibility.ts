import { EventPolicy } from "@prisma/client";
import { db } from "@/lib/db";
import { SessionUser } from "@/lib/session";

export type AccessState = "open" | "locked" | "embargoed";
type CookieReader = { get(name: string): { value: string } | undefined };

function isUnlocked(eventSlug: string, cookieStore: CookieReader | null) {
  if (!cookieStore) return false;
  return cookieStore.get(`event_access_${eventSlug}`)?.value === "1";
}

export function resolveEventAccess({
  eventSlug,
  policy,
  session,
  cookieStore,
}: {
  eventSlug: string;
  policy?: EventPolicy;
  session: SessionUser | null;
  cookieStore: CookieReader | null;
}): AccessState {
  if (session?.role === "ADMIN") return "open";
  if (!policy) return "open";

  const unlocked = isUnlocked(eventSlug, cookieStore);
  const embargoed = !!policy.embargoUntil && policy.embargoUntil.getTime() > Date.now();

  if (embargoed && !unlocked) return "embargoed";
  if (policy.isPrivate && !unlocked) return "locked";
  return "open";
}

export async function getPolicyMap(eventSlugs: string[]) {
  if (eventSlugs.length === 0) return new Map<string, EventPolicy>();

  const policies = await db.eventPolicy.findMany({
    where: { eventSlug: { in: eventSlugs } },
  });

  return new Map(policies.map((policy) => [policy.eventSlug, policy]));
}
