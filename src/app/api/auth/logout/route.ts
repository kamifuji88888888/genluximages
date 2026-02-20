import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME } from "@/lib/session";

export async function POST() {
  const response = NextResponse.json({ ok: true, message: "Logged out." });
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}
