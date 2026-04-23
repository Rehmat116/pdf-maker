import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X, ChevronLeft, ChevronRight, ScanSearch } from "lucide-react";
import { BookImage } from "@/types/book";
import { Button } from "@/components/ui/button";

interface ImagePreviewOverlayProps {
  images: BookImage[];
  activeImageId: string | null;
  onClose: () => void;
  onChangeImage: (id: string) => void;
}

export function ImagePreviewOverlay({ images, activeImageId, onClose, onChangeImage }: ImagePreviewOverlayProps) {
  const [showCropped, setShowCropped] = useState(true);
  const touchStartX = useRef<number | null>(null);

  const activeIndex = useMemo(
    () => images.findIndex((image) => image.id === activeImageId),
    [images, activeImageId],
  );
  const activeImage = activeIndex >= 0 ? images[activeIndex] : null;

  useEffect(() => {
    setShowCropped(true);
  }, [activeImageId]);

  const goTo = useCallback((direction: -1 | 1) => {
    const next = activeIndex + direction;
    if (next < 0 || next >= images.length) {
      return;
    }
    onChangeImage(images[next].id);
  }, [activeIndex, images, onChangeImage]);

  useEffect(() => {
    if (!activeImage) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      } else if (event.key === "ArrowLeft") {
        goTo(-1);
      } else if (event.key === "ArrowRight") {
        goTo(1);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeImage, goTo, onClose]);

  if (!activeImage) {
    return null;
  }

  const handleTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    touchStartX.current = event.touches[0]?.clientX ?? null;
  };

  const handleTouchEnd = (event: React.TouchEvent<HTMLDivElement>) => {
    const startX = touchStartX.current;
    const endX = event.changedTouches[0]?.clientX ?? null;
    if (startX === null || endX === null) {
      return;
    }

    const delta = endX - startX;
    if (Math.abs(delta) < 40) {
      return;
    }

    goTo(delta > 0 ? -1 : 1);
  };

  const displaySrc = showCropped ? activeImage.croppedPreview : activeImage.originalPreview;

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/65 backdrop-blur-md"
      onClick={onClose}
    >
      <div
        className="flex h-full w-full items-center justify-center p-4 md:p-8"
        onClick={(event) => event.stopPropagation()}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <button
          onClick={onClose}
          className="absolute right-5 top-5 rounded-full bg-white/10 p-2 text-white transition hover:bg-white/20"
          aria-label="Close preview"
        >
          <X className="h-5 w-5" />
        </button>

        {activeIndex > 0 && (
          <button
            onClick={() => goTo(-1)}
            className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-3 text-white transition hover:bg-white/20"
            aria-label="Previous image"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        )}

        {activeIndex < images.length - 1 && (
          <button
            onClick={() => goTo(1)}
            className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-3 text-white transition hover:bg-white/20"
            aria-label="Next image"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        )}

        <div className="grid max-h-full w-full max-w-6xl gap-4 overflow-hidden rounded-[28px] border border-white/20 bg-white/10 p-4 text-white shadow-2xl md:grid-cols-[minmax(0,1.4fr)_320px]">
          <div className="min-h-[320px] overflow-hidden rounded-[20px] bg-black/25">
            <img src={displaySrc} alt="Full page preview" className="h-full max-h-[78vh] w-full object-contain" />
          </div>

          <div className="flex flex-col gap-4 rounded-[20px] bg-white/12 p-4">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.24em] text-white/70">PageCraft Preview</p>
              <h2 className="mt-2 font-heading text-2xl">Page Details</h2>
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-2xl bg-white/10 p-3">
                <p className="text-white/60">Pages</p>
                <p className="mt-1 font-mono text-lg">
                  {activeImage.pageNumbers.length > 0 ? activeImage.pageNumbers.join(", ") : "None"}
                </p>
              </div>
              <div className="rounded-2xl bg-white/10 p-3">
                <p className="text-white/60">Confidence</p>
                <p className="mt-1 font-mono text-lg">{activeImage.confidence ?? 0}%</p>
              </div>
            </div>

            <div className="rounded-2xl bg-white/10 p-3 text-sm">
              <p className="text-white/60">Crop Status</p>
              <p className="mt-1">{activeImage.cropApplied ? "Auto crop applied" : "Original image retained"}</p>
            </div>

            <div className="flex gap-2">
              <Button
                type="button"
                onClick={() => setShowCropped(false)}
                variant={!showCropped ? "default" : "outline"}
                className="flex-1 rounded-full border-white/20 bg-white/10 text-white hover:bg-white/20"
              >
                Before
              </Button>
              <Button
                type="button"
                onClick={() => setShowCropped(true)}
                variant={showCropped ? "default" : "outline"}
                className="flex-1 rounded-full border-white/20 bg-white text-black hover:bg-white/90"
              >
                After
              </Button>
            </div>

            <div className="rounded-2xl border border-white/15 bg-black/15 p-3 text-sm text-white/80">
              <div className="mb-2 flex items-center gap-2">
                <ScanSearch className="h-4 w-4" />
                <span>Swipe or use arrow controls to browse</span>
              </div>
              <p>{activeImage.error ? activeImage.error : "Gemini detection completed and ready for PDF output."}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
