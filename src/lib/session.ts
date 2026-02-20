import { cookies } from "next/headers";

export type SessionRole = "PHOTOGRAPHER" | "BUYER" | "ADMIN";

export type SessionUser = {
  email: string;
  name: string;
  role: SessionRole;
};

export const SESSION_COOKIE_NAME = "genlux_session";

export function encodeSession(user: SessionUser) {
  return Buffer.from(JSON.stringify(user)).toString("base64url");
}

export function decodeSession(value?: string | null): SessionUser | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as SessionUser;
    if (!parsed.email || !parsed.name || !parsed.role) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function getServerSession() {
  const store = await cookies();
  return decodeSession(store.get(SESSION_COOKIE_NAME)?.value ?? null);
}
