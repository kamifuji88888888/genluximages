import Image from "next/image";
import Link from "next/link";
import { WatermarkOverlay } from "@/components/WatermarkOverlay";
import { extractImageNumber } from "@/lib/watermark";
import { CatalogImage } from "@/lib/types";

export function ImageCard({ image }: { image: CatalogImage }) {
  return (
    <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="relative">
        <Image
          src={image.previewUrl}
          alt={image.title}
          width={800}
          height={420}
          className="h-52 w-full object-cover"
        />
        <WatermarkOverlay
          photographerName={image.photographer}
          imageNumber={extractImageNumber(image.filename || image.id)}
          compact
        />
      </div>
      <div className="space-y-2 p-4">
        <p className="text-xs uppercase tracking-wide text-slate-500">{image.eventName}</p>
        <h3 className="text-base font-semibold text-slate-900">{image.title}</h3>
        <p className="text-sm text-slate-600">
          {image.photographer} · {new Date(image.capturedAt).toLocaleDateString()}
        </p>
        <div className="flex items-center justify-between pt-1">
          <p className="text-sm font-medium text-slate-900">${image.priceUsd}</p>
          <Link
            href={`/images/${image.id}`}
            className="rounded-full bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
          >
            View / License
          </Link>
        </div>
      </div>
    </article>
  );
}
