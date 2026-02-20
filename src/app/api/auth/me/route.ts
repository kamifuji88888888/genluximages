import { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { decodeSession, SESSION_COOKIE_NAME } from "@/lib/session";

export async function GET(request: NextRequest) {
  const user = decodeSession(request.cookies.get(SESSION_COOKIE_NAME)?.value ?? null);
  return NextResponse.json({ user });
}
