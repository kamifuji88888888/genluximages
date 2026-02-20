import { NextRequest, NextResponse } from "next/server";
import { getEvents, searchCatalog } from "@/lib/catalog-service";
import { getPolicyMap, resolveEventAccess } from "@/lib/event-visibility";
import { decodeSession, SESSION_COOKIE_NAME } from "@/lib/session";
import { UsageRights } from "@/lib/types";

export async function GET(request: NextRequest) {
  const session = decodeSession(request.cookies.get(SESSION_COOKIE_NAME)?.value ?? null);
  const query = request.nextUrl.searchParams.get("q") ?? undefined;
  const eventSlug = request.nextUrl.searchParams.get("event") ?? undefined;
  const rights = (request.nextUrl.searchParams.get("rights") as UsageRights | "all" | null) ?? "all";
  const events = await getEvents();
  const policyMap = await getPolicyMap(events.map((event) => event.eventSlug));
  const allowedEventSlugs = events
    .filter(
      (event) =>
        resolveEventAccess({
          eventSlug: event.eventSlug,
          policy: policyMap.get(event.eventSlug),
          session,
          cookieStore: request.cookies,
        }) === "open",
    )
    .map((event) => event.eventSlug);

  const images = await searchCatalog({ query, eventSlug, rights, allowedEventSlugs });
  return NextResponse.json({ count: images.length, images });
}
