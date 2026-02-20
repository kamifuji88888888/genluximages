import { NextResponse } from "next/server";
import { db } from "@/lib/db";

type Body = {
  eventSlug?: string;
  accessCode?: string;
};

export async function POST(request: Request) {
  const body = (await request.json()) as Body;
  if (!body.eventSlug || !body.accessCode) {
    return NextResponse.json(
      { ok: false, message: "Event slug and code are required." },
      { status: 400 },
    );
  }

  const policy = await db.eventPolicy.findUnique({
    where: { eventSlug: body.eventSlug },
  });

  if (!policy || !policy.isPrivate) {
    return NextResponse.json(
      { ok: false, message: "This event does not require an access code." },
      { status: 400 },
    );
  }

  if (!policy.accessCode || policy.accessCode !== body.accessCode) {
    return NextResponse.json(
      { ok: false, message: "Invalid access code." },
      { status: 401 },
    );
  }

  const response = NextResponse.json({ ok: true, message: "Event unlocked." });
  response.cookies.set({
    name: `event_access_${body.eventSlug}`,
    value: "1",
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7,
  });
  return response;
}
