import { useState, useCallback, useRef } from "react";
import { BookImage, ProcessingState, PageRange } from "@/types/book";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { autoCropImage } from "@/lib/imageCrop";
import { getAutoCropEnabled } from "@/lib/settings";

// --- OPTIMIZED SETTINGS ---
const BATCH_SIZE = 25;
const DELAY_BETWEEN_BATCHES = 12000; // 12 seconds
const MAX_RETRIES = 5;
const INITIAL_RETRY_DELAY = 10000;
const API_TIMEOUT = 45000; // 45 seconds timeout
const AUTO_SCAN_RETRY_LIMIT = 4;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Helper to get current API key from pocket manager
const getApiKey = (): string | null => {
  const stored = localStorage.getItem('smartbook_api_keys');
  if (stored) {
    try {
      const keys = JSON.parse(stored);
      if (keys.length > 0) {
        // Find key with lowest usage
        const sorted = [...keys].sort((a, b) => a.usage - b.usage);
        return sorted[0].key;
      }
    } catch {}
  }
  return localStorage.getItem("MY_GEMINI_KEY") || import.meta.env.VITE_GEMINI_API_KEY || null;
};

// Rotate to next key on rate limit
const rotateApiKey = (): boolean => {
  const stored = localStorage.getItem('smartbook_api_keys');
  if (stored) {
    try {
      const keys = JSON.parse(stored);
      if (keys.length > 1) {
        // Reset first key's usage to max so it gets deprioritized
        keys[0].usage = keys[0].limit;
        localStorage.setItem('smartbook_api_keys', JSON.stringify(keys));
        return true;
      }
    } catch {}
  }
  return false;
};

export function useBookCompiler() {
  const [images, setImages] = useState<BookImage[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPreparingImages, setIsPreparingImages] = useState(false);
  const [preparingState, setPreparingState] = useState({ total: 0, completed: 0 });
  const [processingState, setProcessingState] = useState<ProcessingState>({
    total: 0,
    completed: 0,
    processing: 0,
    errors: 0,
  });
  const abortRef = useRef(false);

  const revokeImageUrls = (image: Pick<BookImage, "originalPreview" | "croppedPreview" | "preview">) => {
    const urls = new Set([image.originalPreview, image.croppedPreview, image.preview].filter(Boolean));
    urls.forEach((url) => URL.revokeObjectURL(url));
  };

  // JIT Compression - only when needed, immediately discarded after
  const compressImageJIT = async (file: File): Promise<string> => {
    const MAX_DIMENSION = 800;
    const QUALITY = 0.6;

    return new Promise((resolve, reject) => {
      const img = new Image();
      const objectUrl = URL.createObjectURL(file);

      img.onload = () => {
        URL.revokeObjectURL(objectUrl);

        let width = img.width;
        let height = img.height;

        if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
          if (width > height) {
            height = Math.round((height * MAX_DIMENSION) / width);
            width = MAX_DIMENSION;
          } else {
            width = Math.round((width * MAX_DIMENSION) / height);
            height = MAX_DIMENSION;
          }
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Could not get canvas context"));
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL("image/jpeg", QUALITY);
        const base64 = dataUrl.split(",")[1];

        // Force garbage collection hints
        canvas.width = 0;
        canvas.height = 0;

        resolve(base64);
      };

      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error("Failed to load image"));
      };

      img.src = objectUrl;
    });
  };

  const isRateLimitError = (err: unknown): boolean => {
    if (!err || typeof err !== "object") return false;
    const anyErr = err as any;
    return anyErr?.status === 429 || anyErr?.message?.includes("429") || anyErr?.message?.includes("rate limit");
  };

  // API call with timeout wrapper
  const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> => {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) => 
        setTimeout(() => reject(new Error(`Request timeout after ${ms/1000}s`)), ms)
      )
    ]);
  };

  const detectPageNumbersBatch = async (
    imagesBase64: string[],
    imageIds: string[],
    retryCount = 0,
  ): Promise<number[][]> => {
    console.log(`Sending batch of ${imagesBase64.length} images to Gemini 2.5...`);

    try {
      const apiKey = getApiKey();
      if (!apiKey) {
        throw new Error("No API Key configured");
      }

      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

      const parts: any[] = [];
      parts.push({
        text: `You are analyzing ${imagesBase64.length} book page images. For EACH image, extract the printed page number(s).
RULES:
- Return page numbers as integers.
- If no page number is visible, return an empty array.
- Ignore chapter numbers.
Respond with a JSON array containing ${imagesBase64.length} sub-arrays.
Example: [[42], [14, 15], []]
RESPOND ONLY WITH THE JSON ARRAY.`,
      });

      imagesBase64.forEach((base64) => {
        parts.push({
          inlineData: {
            mimeType: "image/jpeg",
            data: base64,
          },
        });
      });

      const result = await withTimeout(model.generateContent(parts), API_TIMEOUT);
      const response = await result.response;
      const text = response.text().trim();

      console.log("Gemini batch response:", text);

      const cleanText = text
        .replace(/```json/g, "")
        .replace(/```/g, "")
        .trim();
      const jsonMatch = cleanText.match(/\[[\s\S]*\]/);

      if (!jsonMatch) {
        return imagesBase64.map(() => []);
      }

      const parsed = JSON.parse(jsonMatch[0]);

      if (!Array.isArray(parsed)) {
        return imagesBase64.map(() => []);
      }

      return parsed.map((item: any) => {
        if (Array.isArray(item)) {
          return item.filter((n: any) => typeof n === "number" && Number.isInteger(n) && n > 0);
        }
        if (typeof item === "number" && Number.isInteger(item) && item > 0) {
          return [item];
        }
        return [];
      });
    } catch (error: any) {
      if (isRateLimitError(error) && retryCount < MAX_RETRIES) {
        // Try rotating to next key
        const rotated = rotateApiKey();
        const waitTime = rotated ? 3000 : INITIAL_RETRY_DELAY + retryCount * 5000;
        
        console.log(`Rate limit hit. ${rotated ? 'Rotating key.' : ''} Waiting ${waitTime / 1000}s...`);

        setImages((prev) =>
          prev.map((img) =>
            imageIds.includes(img.id) ? { ...img, error: `Rate limited. Waiting ${waitTime / 1000}s...` } : img,
          ),
        );

        await sleep(waitTime);
        return detectPageNumbersBatch(imagesBase64, imageIds, retryCount + 1);
      }
      throw new Error(error?.message || "Failed to detect page numbers");
    }
  };

  const getExistingPageNumbers = (allImages: BookImage[], excludeIds?: string[]): Set<number> => {
    const pages = new Set<number>();
    allImages.forEach((img) => {
      if (excludeIds && excludeIds.includes(img.id)) return;
      if (img.status === "completed" && img.pageNumbers.length > 0) {
        img.pageNumbers.forEach((p) => pages.add(p));
      }
    });
    return pages;
  };

  const hasAnyDuplicatePage = (newPageNumbers: number[], existingPages: Set<number>): number | null => {
    for (const page of newPageNumbers) {
      if (existingPages.has(page)) {
        return page;
      }
    }
    return null;
  };

  // JIT batch processing - compress only when sending
  const processBatch = async (batchImages: BookImage[], existingPages: Set<number>): Promise<BookImage[]> => {
    const base64Data: string[] = [];
    const imageIds: string[] = [];
    const failedIds: string[] = [];

    // JIT compression - convert only now, discard immediately after
    for (const image of batchImages) {
      try {
        const base64 = await compressImageJIT(image.file);
        base64Data.push(base64);
        imageIds.push(image.id);
      } catch (err) {
        console.error("Failed to convert image:", err);
        failedIds.push(image.id);
      }
    }

    if (base64Data.length === 0) {
      return batchImages.map((img) => ({
        ...img,
        status: "error" as const,
        error: "Failed to read image",
      }));
    }

    const finalizeImageResult = (img: BookImage, pageNumbers: number[], retryCount = 0): BookImage => {
      if (pageNumbers.length > 0) {
        const duplicatePage = hasAnyDuplicatePage(pageNumbers, existingPages);
        if (duplicatePage !== null) {
          return {
            ...img,
            status: "error" as const,
            pageNumbers: [],
            retryCount,
            error: `Skipped: Page ${duplicatePage} already exists`,
          };
        }
        pageNumbers.forEach((p) => existingPages.add(p));
      }

      return {
        ...img,
        status: "completed" as const,
        pageNumbers,
        retryCount,
        confidence: pageNumbers.length > 1 ? 97 : pageNumbers.length === 1 ? 91 : 42,
        error: undefined,
      };
    };

    const retrySingleImageScan = async (img: BookImage): Promise<BookImage> => {
      for (let attempt = 1; attempt <= AUTO_SCAN_RETRY_LIMIT; attempt += 1) {
        try {
          setImages((prev) =>
            prev.map((item) =>
              item.id === img.id
                ? {
                    ...item,
                    status: "processing" as const,
                    retryCount: attempt,
                    error: `Auto retry ${attempt}/${AUTO_SCAN_RETRY_LIMIT}...`,
                  }
                : item,
            ),
          );

          const base64 = await compressImageJIT(img.file);
          const result = await detectPageNumbersBatch([base64], [img.id]);
          return finalizeImageResult(img, result[0] || [], attempt);
        } catch (retryError) {
          if (attempt === AUTO_SCAN_RETRY_LIMIT) {
            return {
              ...img,
              status: "error" as const,
              retryCount: attempt,
              error: `Scan failed after ${AUTO_SCAN_RETRY_LIMIT} retries. Use manual retry.`,
            };
          }
        }
      }

      return {
        ...img,
        status: "error" as const,
        retryCount: AUTO_SCAN_RETRY_LIMIT,
        error: `Scan failed after ${AUTO_SCAN_RETRY_LIMIT} retries. Use manual retry.`,
      };
    };

    try {
      const batchResults = await detectPageNumbersBatch(base64Data, imageIds);
      
      // Immediately clear base64 data from memory
      base64Data.length = 0;

      const processedImages: BookImage[] = batchImages.map((img) => {
        if (failedIds.includes(img.id)) {
          return {
            ...img,
            status: "error" as const,
            retryCount: 0,
            error: "Failed to read image",
          };
        }

        const resultIdx = imageIds.indexOf(img.id);
        if (resultIdx === -1) {
          return {
            ...img,
            status: "error" as const,
            retryCount: 0,
            error: "Processing error",
          };
        }

        const pageNumbers = batchResults[resultIdx] || [];
        return finalizeImageResult(img, pageNumbers);
      });

      return processedImages;
    } catch (error) {
      const retriedResults = await Promise.all(
        batchImages.map((img) =>
          failedIds.includes(img.id)
            ? Promise.resolve({
                ...img,
                status: "error" as const,
                retryCount: 0,
                error: "Failed to read image",
              } satisfies BookImage)
            : retrySingleImageScan(img),
        ),
      );

      return retriedResults.map((result) =>
        result.status === "error" && !result.error
          ? { ...result, error: error instanceof Error ? error.message : "Unknown error" }
          : result,
      );
    }
  };

  const removeDuplicates = useCallback((): number => {
    let removedCount = 0;
    const skippedIds: string[] = [];

    images.forEach((img) => {
      if (
        img.status === "error" &&
        img.error &&
        (img.error.toLowerCase().includes("skipped") || img.error.toLowerCase().includes("duplicate"))
      ) {
        skippedIds.push(img.id);
      }
    });
    removedCount += skippedIds.length;

    const remainingImages = images.filter((img) => !skippedIds.includes(img.id));
    const seenPages = new Set<number>();
    const duplicateIds: string[] = [];

    const sortedImages = [...remainingImages].sort((a, b) => {
      const aTime = parseInt(a.id.split("-")[0]);
      const bTime = parseInt(b.id.split("-")[0]);
      return aTime - bTime;
    });

    sortedImages.forEach((img) => {
      if (img.status !== "completed" || img.pageNumbers.length === 0) return;
      const hasDuplicate = img.pageNumbers.some((p) => seenPages.has(p));
      if (hasDuplicate) {
        duplicateIds.push(img.id);
      } else {
        img.pageNumbers.forEach((p) => seenPages.add(p));
      }
    });
    removedCount += duplicateIds.length;
    const allIdsToRemove = [...skippedIds, ...duplicateIds];

    if (allIdsToRemove.length > 0) {
      setImages((prev) => {
        const toRemove = prev.filter((img) => allIdsToRemove.includes(img.id));
        toRemove.forEach((img) => revokeImageUrls(img));
        return prev.filter((img) => !allIdsToRemove.includes(img.id));
      });
    }
    return removedCount;
  }, [images]);

  // Zero-overhead add - just blob URLs, no FileReader
  const addImages = useCallback(async (files: File[]) => {
    setIsPreparingImages(true);
    setPreparingState({ total: files.length, completed: 0 });
    const autoCropEnabled = getAutoCropEnabled();

    const newImages: BookImage[] = [];

    try {
      for (const [index, file] of files.entries()) {
        const cropped = await autoCropImage(file);
        const newImage = {
          id: `${Date.now()}-${index}-${Math.random().toString(36).substr(2, 9)}`,
          file: autoCropEnabled ? cropped.file : file,
          preview: autoCropEnabled ? cropped.croppedPreview : cropped.originalPreview,
          originalPreview: cropped.originalPreview,
          croppedPreview: autoCropEnabled ? cropped.croppedPreview : cropped.originalPreview,
          cropApplied: autoCropEnabled ? cropped.cropApplied : false,
          status: "pending" as const,
          pageNumbers: [],
          retryCount: 0,
        } satisfies BookImage;

        newImages.push(newImage);
        setImages((prev) => [...prev, newImage]);
        setPreparingState({ total: files.length, completed: index + 1 });

        if ((index + 1) % 5 === 0) {
          await sleep(0);
        }
      }

      return newImages;
    } finally {
      setIsPreparingImages(false);
      setPreparingState({ total: 0, completed: 0 });
    }
  }, []);

  const removeImage = useCallback((id: string) => {
    setImages((prev) => {
      const image = prev.find((img) => img.id === id);
      if (image) {
        revokeImageUrls(image);
      }
      return prev.filter((img) => img.id !== id);
    });
  }, []);

  const clearAll = useCallback(() => {
    images.forEach((img) => revokeImageUrls(img));
    setImages([]);
    setProcessingState({ total: 0, completed: 0, processing: 0, errors: 0 });
  }, [images]);

  const startProcessing = useCallback(async () => {
    const pendingImages = images.filter((img) => img.status === "pending");
    if (pendingImages.length === 0) return;

    setIsProcessing(true);
    abortRef.current = false;

    setProcessingState({
      total: pendingImages.length,
      completed: 0,
      processing: 0,
      errors: 0,
    });

    const existingPages = getExistingPageNumbers(images);
    const batches: BookImage[][] = [];
    for (let i = 0; i < pendingImages.length; i += BATCH_SIZE) {
      batches.push(pendingImages.slice(i, i + BATCH_SIZE));
    }

    let completedCount = 0;
    let errorCount = 0;

    for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
      if (abortRef.current) break;
      const batch = batches[batchIdx];

      setImages((prev) =>
        prev.map((img) => (batch.some((b) => b.id === img.id) ? { ...img, status: "processing" as const } : img)),
      );
      setProcessingState((prev) => ({ ...prev, processing: batch.length }));

      const results = await processBatch(batch, existingPages);

      setImages((prev) =>
        prev.map((img) => {
          const result = results.find((r) => r.id === img.id);
          return result || img;
        }),
      );

      const batchCompleted = results.filter((r) => r.status === "completed").length;
      const batchErrors = results.filter((r) => r.status === "error").length;
      completedCount += batchCompleted;
      errorCount += batchErrors;

      setProcessingState((prev) => ({
        ...prev,
        completed: completedCount,
        errors: errorCount,
        processing: 0,
      }));

      if (batchIdx < batches.length - 1 && !abortRef.current) {
        await sleep(DELAY_BETWEEN_BATCHES);
      }
    }
    setIsProcessing(false);
  }, [images]);

  const stopProcessing = useCallback(() => {
    abortRef.current = true;
    setIsProcessing(false);
  }, []);

  const rescanImage = useCallback(
    async (imageId: string) => {
      const targetImage = images.find((img) => img.id === imageId);
      if (!targetImage || targetImage.status !== "error") return;

      setImages((prev) =>
        prev.map((img) => (img.id === imageId ? { ...img, status: "processing" as const, retryCount: 0, error: undefined } : img)),
      );

      try {
        const existingPages = getExistingPageNumbers(images, [imageId]);

        for (let attempt = 1; attempt <= AUTO_SCAN_RETRY_LIMIT; attempt += 1) {
          try {
            setImages((prev) =>
              prev.map((img) =>
                img.id === imageId
                  ? { ...img, status: "processing" as const, retryCount: attempt, error: `Manual retry ${attempt}/${AUTO_SCAN_RETRY_LIMIT}...` }
                  : img,
              ),
            );

            const base64 = await compressImageJIT(targetImage.file);
            const results = await detectPageNumbersBatch([base64], [imageId]);
            const pageNumbers = results[0] || [];

            if (pageNumbers.length > 0) {
              const duplicatePage = hasAnyDuplicatePage(pageNumbers, existingPages);
              if (duplicatePage !== null) {
                setImages((prev) =>
                  prev.map((img) =>
                    img.id === imageId
                      ? {
                          ...img,
                          status: "error" as const,
                          pageNumbers: [],
                          retryCount: attempt,
                          error: `Skipped: Page ${duplicatePage} already exists`,
                        }
                      : img,
                  ),
                );
                return;
              }
            }

            setImages((prev) =>
              prev.map((img) =>
                img.id === imageId
                  ? {
                      ...img,
                      status: "completed" as const,
                      pageNumbers,
                      retryCount: attempt,
                      confidence: pageNumbers.length > 1 ? 97 : pageNumbers.length === 1 ? 91 : 42,
                      error: undefined,
                    }
                  : img,
              ),
            );
            return;
          } catch (retryErr) {
            if (attempt === AUTO_SCAN_RETRY_LIMIT) {
              throw retryErr;
            }
          }
        }
      } catch (err) {
        setImages((prev) =>
          prev.map((img) =>
            img.id === imageId
              ? {
                  ...img,
                  status: "error" as const,
                  retryCount: AUTO_SCAN_RETRY_LIMIT,
                  error: `Manual retry failed after ${AUTO_SCAN_RETRY_LIMIT} attempts.`,
                }
              : img,
          ),
        );
      }
    },
    [images],
  );

  const getPageRange = useCallback((): PageRange | null => {
    const allPages = images.filter((img) => img.status === "completed").flatMap((img) => img.pageNumbers);
    if (allPages.length === 0) return null;
    const uniquePages = [...new Set(allPages)].sort((a, b) => a - b);
    const min = Math.min(...uniquePages);
    const max = Math.max(...uniquePages);
    const missing: number[] = [];
    for (let i = min; i <= max; i++) {
      if (!uniquePages.includes(i)) missing.push(i);
    }
    return { min, max, missing };
  }, [images]);

  const getSortedImages = useCallback(() => {
    return [...images]
      .filter((img) => img.status === "completed" && img.pageNumbers.length > 0)
      .sort((a, b) => {
        const aMin = Math.min(...a.pageNumbers);
        const bMin = Math.min(...b.pageNumbers);
        return aMin - bMin;
      });
  }, [images]);

  return {
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
  };
}
