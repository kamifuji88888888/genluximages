"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

const LOCAL_SAVED_IMAGE_IDS_KEY = "genlux_local_saved_image_ids";
const LOCAL_SAVED_UPDATED_EVENT = "genlux-local-saved-updated";

function readLocalSavedCount() {
  if (typeof window === "undefined") return 0;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(LOCAL_SAVED_IMAGE_IDS_KEY) || "[]") as unknown;
    if (!Array.isArray(parsed)) return 0;
    return parsed.filter((entry): entry is string => typeof entry === "string").length;
  } catch {
    return 0;
  }
}

const navItems = [
  { href: "/", label: "Search" },
  { href: "/attendee", label: "Attendee Portal" },
  { href: "/agency", label: "Agency Portal" },
  { href: "/galleries", label: "Galleries" },
  { href: "/upload", label: "Photographer Upload" },
  { href: "/admin/review", label: "Admin Review" },
  { href: "/admin/presets", label: "Admin Presets" },
  { href: "/cart", label: "Cart" },
  { href: "/login", label: "Login" },
];

export function SiteHeader() {
  const pathname = usePathname();
  const [logoError, setLogoError] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [localSavedCount, setLocalSavedCount] = useState(() => readLocalSavedCount());
  const logoPath = process.env.NEXT_PUBLIC_LOGO_PATH || "/genlux-logo.png";

  const localSavedBadge = useMemo(() => {
    if (isLoggedIn || localSavedCount < 1) return null;
    return (
      <Link
        href="/login?next=/galleries"
        className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900 hover:bg-amber-200"
      >
        Local picks: {localSavedCount}
      </Link>
    );
  }, [isLoggedIn, localSavedCount]);

  useEffect(() => {
    void (async () => {
      const response = await fetch("/api/auth/me");
      const data = (await response.json()) as { user: { email: string } | null };
      setIsLoggedIn(Boolean(data.user));
    })();

    const onStorage = (event: StorageEvent) => {
      if (event.key && event.key !== LOCAL_SAVED_IMAGE_IDS_KEY) return;
      setLocalSavedCount(readLocalSavedCount());
    };

    const onLocalSavedUpdated = (event: Event) => {
      const customEvent = event as CustomEvent<{ count?: number }>;
      if (typeof customEvent.detail?.count === "number") {
        setLocalSavedCount(customEvent.detail.count);
        return;
      }
      setLocalSavedCount(readLocalSavedCount());
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener(LOCAL_SAVED_UPDATED_EVENT, onLocalSavedUpdated as EventListener);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(LOCAL_SAVED_UPDATED_EVENT, onLocalSavedUpdated as EventListener);
    };
  }, []);

  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-2.5">
        <Link
          href="/"
          aria-label="Home"
          className="flex items-center gap-2 text-lg font-semibold tracking-wide text-slate-900"
        >
          {!logoError ? (
            <Image
              src={logoPath}
              alt="GENLUXIMAGES logo"
              width={120}
              height={32}
              unoptimized
              className="h-8 w-auto"
              onError={() => setLogoError(true)}
            />
          ) : null}
        </Link>

        <nav className="ml-4 flex items-center gap-1 text-[11px] uppercase tracking-normal">
          {localSavedBadge}
          {navItems.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-full px-2 py-0.5 ${
                  active
                    ? "bg-slate-900 text-white"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
