import { NextResponse } from "next/server";
import { encodeSession, SESSION_COOKIE_NAME, SessionRole } from "@/lib/session";

type LoginBody = {
  email?: string;
  name?: string;
  role?: SessionRole;
};

export async function POST(request: Request) {
  const body = (await request.json()) as LoginBody;

  if (!body.email || !body.name || !body.role) {
    return NextResponse.json(
      { ok: false, message: "Missing login fields." },
      { status: 400 },
    );
  }

  const response = NextResponse.json({ ok: true, message: "Logged in." });
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: encodeSession({
      email: body.email.toLowerCase(),
      name: body.name,
      role: body.role,
    }),
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });

  return response;
}
