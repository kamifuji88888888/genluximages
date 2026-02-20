import Image from "next/image";
import { formatPhotographerName } from "@/lib/watermark";

type WatermarkOverlayProps = {
  photographerName: string;
  imageNumber: string;
  compact?: boolean;
};

export function WatermarkOverlay({
  photographerName,
  imageNumber,
  compact = false,
}: WatermarkOverlayProps) {
  const photographerText = formatPhotographerName(photographerName);

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      <div
        className={`absolute -left-3 overflow-hidden rounded-sm bg-black/20 ${
          compact ? "bottom-8 h-[34px] w-[calc(50%+24px)] min-w-[204px]" : "bottom-10 h-[42px] w-[calc(40%+24px)] min-w-[304px]"
        }`}
      >
        <div className="absolute left-[calc(6%+24px)] top-[8%] h-[63%] w-[92%] overflow-hidden">
          <Image
            src="/watermark/genlux-credit-template-4-logo-only.png"
            alt="GENLUXIMAGES watermark logo"
            fill
            unoptimized
            className="object-contain object-left-top"
          />
        </div>
        <p
          className={`absolute ${
            compact ? "left-[calc(7%+24px)] top-[66%] text-[3.2px]" : "left-[calc(7%+24px)] top-[66%] text-[3.6px]"
          } max-w-[88%] truncate font-normal uppercase tracking-wide text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)] [font-family:'Futura_PT','Futura','Arial',sans-serif]`}
        >
          CREDIT: {photographerText}
        </p>
      </div>

      <div
        className={`absolute bottom-2 left-2 rounded bg-black/55 px-1.5 py-0.5 text-white ${
          compact ? "text-[9px]" : "text-[10px]"
        } font-semibold tracking-wide`}
      >
        {imageNumber}
      </div>
    </div>
  );
}
