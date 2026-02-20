import type { Metadata } from "next";
import Link from "next/link";
import { LUXURY_CITIES, LUXURY_VERTICALS, absoluteUrl } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Luxury Photo Hubs",
  description:
    "Browse luxury-focused photo discovery hubs by city and vertical for Los Angeles and New York.",
  alternates: { canonical: absoluteUrl("/luxury") },
};

export default function LuxuryHubPage() {
  return (
    <div className="space-y-6">
      <header className="rounded-2xl border border-slate-200 bg-white p-6">
        <p className="text-xs uppercase tracking-wide text-slate-500">Luxury hubs</p>
        <h1 className="text-3xl font-semibold text-slate-900">Luxury Discovery by City + Vertical</h1>
        <p className="mt-2 text-sm text-slate-600">
          Built for agencies, editors, and attendees who want premium Los Angeles and New York coverage.
        </p>
      </header>

      <section className="grid gap-4 md:grid-cols-2">
        {LUXURY_CITIES.map((city) => (
          <article key={city.slug} className="rounded-2xl border border-slate-200 bg-white p-4">
            <h2 className="text-xl font-semibold text-slate-900">{city.label}</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {LUXURY_VERTICALS.map((vertical) => (
                <Link
                  key={`${city.slug}-${vertical.slug}`}
                  href={`/luxury/${city.slug}/${vertical.slug}`}
                  className="rounded-full border border-slate-300 px-3 py-1 text-xs hover:bg-slate-50"
                >
                  {vertical.label}
                </Link>
              ))}
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
