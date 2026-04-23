import { useEffect, useState, useRef, useMemo, useCallback } from "react";
import { Header } from "@/components/Header";
import { DropZone } from "@/components/DropZone";
import { ImageCard } from "@/components/ImageCard";
import { ProgressBar } from "@/components/ProgressBar";
import { PageRangeBanner } from "@/components/PageRangeBanner";
import { ActionBar } from "@/components/ActionBar";
import { ImagePreviewOverlay } from "@/components/ImagePreviewOverlay";
import { useBookCompiler } from "@/hooks/useBookCompiler";
import { useKeyManager } from "@/hooks/useKeyManager";
import { generatePDF, downloadBlob } from "@/lib/pdfGenerator";
import { toast } from "@/hooks/use-toast";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { BookImage } from "@/types/book";

const IMAGES_PER_PAGE = 20;

interface ImageGridWithPaginationProps {
  images: BookImage[];
  currentPage: number;
  setCurrentPage: (page: number) => void;
  onRemove: (id: string) => void;
  onRescan: (id: string) => void;
  onPreview: (id: string) => void;
}

const ImageGridWithPagination = ({
  images,
  currentPage,
  setCurrentPage,
  onRemove,
  onRescan,
  onPreview,
}: ImageGridWithPaginationProps) => {
  const totalPages = Math.ceil(images.length / IMAGES_PER_PAGE);

  useEffect(() => {
    if (currentPage > totalPages && totalPages > 0) {
      setCurrentPage(totalPages);
    }
  }, [images.length, currentPage, totalPages, setCurrentPage]);

  const paginatedImages = useMemo(() => {
    const startIndex = (currentPage - 1) * IMAGES_PER_PAGE;
    return images.slice(startIndex, startIndex + IMAGES_PER_PAGE);
  }, [images, currentPage]);

  const goToPage = useCallback((page: number) => {
    setCurrentPage(Math.max(1, Math.min(page, totalPages)));
  }, [setCurrentPage, totalPages]);

  return (
    <div className="space-y-5 border-t border-border pt-5">
      <div className="flex items-center justify-between">
        <h2 className="font-heading text-2xl text-foreground">
          Uploaded Images ({images.length})
        </h2>

        {totalPages > 1 && (
          <span className="text-sm text-muted-foreground">
            Page {currentPage} of {totalPages}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
        {paginatedImages.map((image, index) => (
          <div key={image.id} className="animate-card-in opacity-0">
            <ImageCard
              image={image}
              index={index}
              onRemove={onRemove}
              onRescan={onRescan}
              onPreview={onPreview}
            />
          </div>
        ))}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => goToPage(currentPage - 1)}
            disabled={currentPage === 1}
            className="gap-1 rounded-full"
          >
            <ChevronLeft className="h-4 w-4" />
            Prev
          </Button>

          <div className="flex items-center gap-1">
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              let pageNum: number;
              if (totalPages <= 5) {
                pageNum = i + 1;
              } else if (currentPage <= 3) {
                pageNum = i + 1;
              } else if (currentPage >= totalPages - 2) {
                pageNum = totalPages - 4 + i;
              } else {
                pageNum = currentPage - 2 + i;
              }

              return (
                <Button
                  key={pageNum}
                  variant={pageNum === currentPage ? "default" : "ghost"}
                  size="sm"
                  onClick={() => goToPage(pageNum)}
                  className="h-9 w-9 rounded-full p-0"
                >
                  {pageNum}
                </Button>
              );
            })}
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => goToPage(currentPage + 1)}
            disabled={currentPage === totalPages}
            className="gap-1 rounded-full"
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
};

const Index = () => {
  const { hasKeys, addKey } = useKeyManager();
  const [tempKey, setTempKey] = useState("");
  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [activePreviewImageId, setActivePreviewImageId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const legacyKey = localStorage.getItem("MY_GEMINI_KEY");
    if (legacyKey && !hasKeys) {
      addKey(legacyKey, "Default Key");
      localStorage.removeItem("MY_GEMINI_KEY");
    }
  }, [hasKeys, addKey]);

  const showKeyPrompt = !hasKeys && !localStorage.getItem("MY_GEMINI_KEY") && !import.meta.env.VITE_GEMINI_API_KEY;

  const {
    images,
    isProcessing,
    isPreparingImages,
    preparingState,
    processingState,
    addImages,
    removeImage,
    clearAll,
    startProcessing,
    stopProcessing,
    getPageRange,
    getSortedImages,
    removeDuplicates,
    rescanImage,
    retryFailedImages,
  } = useBookCompiler();

  const handleFilesAdded = async (files: File[]) => {
    await addImages(files);
    toast({
      title: "Images Added",
      description: `${files.length} image${files.length > 1 ? "s" : ""} added and auto-cropped`,
    });
  };

  const handleDownloadPDF = async () => {
    const sortedImages = getSortedImages();
    if (sortedImages.length === 0) {
      toast({
        title: "No Images Ready",
        description: "Process some images first",
        variant: "destructive",
      });
      return;
    }

    setIsGeneratingPDF(true);
    try {
      const blob = await generatePDF(sortedImages);
      const range = getPageRange();
      const filename = range ? `book-pages-${range.min}-${range.max}.pdf` : "compiled-book.pdf";

      downloadBlob(blob, filename);

      toast({
        title: "PDF Generated",
        description: `${sortedImages.length} pages compiled`,
      });
    } catch (error) {
      console.error("PDF generation error:", error);
      toast({
        title: "PDF Failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setIsGeneratingPDF(false);
    }
  };

  const handleUploadMissing = () => {
    fileInputRef.current?.click();
  };

  const handleRemoveDuplicates = () => {
    const removed = removeDuplicates();
    toast({
      title: removed > 0 ? "Duplicates Removed" : "No Duplicates",
      description: removed > 0 ? `Removed ${removed} duplicate${removed > 1 ? "s" : ""}` : "All unique",
    });
  };

  if (showKeyPrompt) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="w-full max-w-md rounded-[28px] border border-border bg-card p-6 shadow-[0_24px_70px_-38px_rgba(26,26,26,0.38)]">
          <h2 className="mb-2 font-heading text-3xl text-foreground">API Key Required</h2>
          <p className="mb-6 text-sm text-muted-foreground">
            Enter your Gemini API Key to get started. Stored locally on your device.
          </p>

          <input
            type="text"
            value={tempKey}
            onChange={(e) => setTempKey(e.target.value)}
            placeholder="Paste AIza... key"
            className="mb-4 w-full rounded-2xl border border-border bg-secondary p-3 font-mono text-sm text-foreground outline-none transition focus:border-[hsl(var(--accent))]/50"
          />

          <Button
            onClick={() => {
              if (tempKey.length > 10) {
                addKey(tempKey, "Default Key");
                window.location.reload();
              } else {
                toast({ title: "Invalid Key", variant: "destructive" });
              }
            }}
            className="h-12 w-full rounded-full bg-[linear-gradient(135deg,#e8b84b,#c9a84c)] text-[#1A1A1A] hover:opacity-95"
          >
            Save & Continue
          </Button>
        </div>
      </div>
    );
  }

  const pageRange = getPageRange();

  return (
    <div className="min-h-screen bg-background">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*"
        className="hidden"
        onClick={(e) => {
          e.currentTarget.value = "";
        }}
        onChange={(e) => {
          if (e.target.files) {
            void handleFilesAdded(Array.from(e.target.files));
          }
        }}
      />

      <Header />

      <main className="mx-auto max-w-6xl px-4 pb-28 pt-8">
        <div className="space-y-6 rounded-[32px] border border-border/90 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(255,255,255,0.88))] p-4 shadow-[0_36px_80px_-52px_rgba(26,26,26,0.28)] md:p-6">
          <section className="space-y-3">
            <span className="font-mono text-xs uppercase tracking-[0.24em] text-[hsl(var(--accent))]">
              Book Scanner PDF Builder
            </span>
            <h1 className="font-heading text-4xl leading-tight text-foreground md:text-5xl">
              Scan, clean, and assemble book pages into a polished PDF.
            </h1>
            <p className="max-w-2xl text-sm text-muted-foreground md:text-base">
              Auto-crop runs on upload, Gemini reads the cleaned pages, and your pages stay sequenced for export.
            </p>
          </section>

          <DropZone
            onFilesAdded={(files) => void handleFilesAdded(files)}
            disabled={isProcessing || isPreparingImages}
            helperText={
              isPreparingImages && preparingState.total > 0
                ? `Preparing ${preparingState.completed}/${preparingState.total} images...`
                : undefined
            }
          />

          {isPreparingImages && (
            <div className="rounded-[20px] border border-border bg-card p-4 shadow-sm">
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="font-medium text-foreground">Preparing images...</span>
                <span className="text-muted-foreground">
                  {preparingState.completed} / {preparingState.total}
                </span>
              </div>
              <div className="relative h-2 overflow-hidden rounded-full bg-secondary">
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-[linear-gradient(90deg,#e8b84b,#c9a84c)] transition-all duration-300"
                  style={{
                    width: preparingState.total > 0
                      ? `${(preparingState.completed / preparingState.total) * 100}%`
                      : "0%",
                  }}
                />
              </div>
            </div>
          )}

          <ProgressBar state={processingState} isProcessing={isProcessing} />

          <PageRangeBanner range={pageRange} onUploadMissing={handleUploadMissing} />

          {images.length > 0 && (
            <ImageGridWithPagination
              images={images}
              currentPage={currentPage}
              setCurrentPage={setCurrentPage}
              onRemove={removeImage}
              onRescan={rescanImage}
              onPreview={setActivePreviewImageId}
            />
          )}

          {images.length === 0 && (
            <div className="rounded-[24px] border border-dashed border-border bg-secondary/50 py-10 text-center">
              <p className="text-sm text-muted-foreground">Upload book page images to get started</p>
            </div>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          PageCraft • Premium page sequencing powered by AI
        </p>
      </main>

      <ActionBar
        images={images}
        isProcessing={isProcessing}
        onStartProcessing={startProcessing}
        onStopProcessing={stopProcessing}
        onRetryFailed={retryFailedImages}
        onDownloadPDF={handleDownloadPDF}
        onClearAll={clearAll}
        onRemoveDuplicates={handleRemoveDuplicates}
        isGeneratingPDF={isGeneratingPDF}
      />

      <ImagePreviewOverlay
        images={images}
        activeImageId={activePreviewImageId}
        onChangeImage={setActivePreviewImageId}
        onClose={() => setActivePreviewImageId(null)}
      />
    </div>
  );
};

export default Index;
