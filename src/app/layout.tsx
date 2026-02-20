import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { SiteHeader } from "@/components/SiteHeader";
import { absoluteUrl, getSiteUrl } from "@/lib/seo";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: getSiteUrl(),
  title: {
    default: "GENLUXIMAGES | Luxury Event & Editorial Image Licensing",
    template: "%s | GENLUXIMAGES",
  },
  description:
    "Luxury-first photo licensing marketplace for Los Angeles and New York: fashion, beauty, luxury cars, yachts, watches, and private aviation coverage.",
  applicationName: "GENLUXIMAGES",
  alternates: { canonical: "/" },
  keywords: [
    "luxury event photography",
    "editorial image licensing",
    "Los Angeles fashion photos",
    "New York fashion photos",
    "luxury car event photos",
    "yacht event photos",
    "watch launch photos",
    "private jet editorial images",
  ],
  openGraph: {
    type: "website",
    url: absoluteUrl("/"),
    title: "GENLUXIMAGES | Luxury Event & Editorial Image Licensing",
    description:
      "License premium event and editorial imagery in Los Angeles and New York.",
    siteName: "GENLUXIMAGES",
  },
  twitter: {
    card: "summary_large_image",
    title: "GENLUXIMAGES | Luxury Event & Editorial Image Licensing",
    description:
      "Luxury-first image licensing marketplace for newsrooms, agencies, and attendees.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const organizationJsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "GENLUXIMAGES",
    url: absoluteUrl("/"),
    description:
      "Luxury-first event and editorial photo licensing marketplace focused on Los Angeles and New York.",
    areaServed: ["Los Angeles", "New York"],
    sameAs: [],
  };
  const websiteJsonLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "GENLUXIMAGES",
    url: absoluteUrl("/"),
    potentialAction: {
      "@type": "SearchAction",
      target: `${absoluteUrl("/")}?q={search_term_string}`,
      "query-input": "required name=search_term_string",
    },
  };

  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteJsonLd) }}
        />
        <SiteHeader />
        <main className="mx-auto min-h-[calc(100vh-68px)] max-w-6xl px-4 py-8">
          {children}
        </main>
      </body>
    </html>
  );
}
