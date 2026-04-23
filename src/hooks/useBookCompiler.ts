import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { BookImage, ProcessingState, PageRange } from "@/types/book";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { autoCrop, compressImage, dataUrlToFile, dataUrlToObjectUrl } from "@/lib/imageCrop";
import { getAutoCropEnabled } from "@/lib/settings";

const BATCH_SIZE = 25;
const DELAY_BETWEEN_BATCHES = 200;
const MAX_RETRIES = 5;
const INITIAL_RETRY_DELAY = 10000;
const API_TIMEOUT = 45000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isFailedImage = (img: BookImage) =>
  img.status === "error" || (typeof img.confidence === "number" && img.confidence < 60);

const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Failed to read file as base64"));
        return;
      }
      resolve(result.split(",")[1]);
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });

const getApiKey = (): string | null => {
  const stored = localStorage.getItem("smartbook_api_keys");
  if (stored) {
    try {
      const keys = JSON.parse(stored);
      if (keys.length > 0) {
        const sorted = [...keys].sort((a, b) => a.usage - b.usage);
        return sorted[0].key;
      }
    } catch {}
  }
  return localStorage.getItem("MY_GEMINI_KEY") || import.meta.env.VITE_GEMINI_API_KEY || null;
};

const rotateApiKey = (): boolean => {
  const stored = localStorage.getItem("smartbook_api_keys");
  if (stored) {
    try {
      const keys = JSON.parse(stored);
      if (keys.length > 1) {
        keys[0].usage = keys[0].limit;
        localStorage.setItem("smartbook_api_keys", JSON.stringify(keys));
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
  const [failedImageIds, setFailedImageIds] = useState<string[]>([]);
  const abortRef = useRef(false);

  useEffect(() => {
    setFailedImageIds(images.filter(isFailedImage).map((img) => img.id));
  }, [images]);

  const failedImages = useMemo(
    () => images.filter((img) => failedImageIds.includes(img.id)),
    [images, failedImageIds],
  );

  const revokeImageUrls = (image: Pick<BookImage, "originalPreview" | "croppedPreview" | "preview">) => {
    const urls = new Set([image.originalPreview, image.croppedPreview, image.preview].filter(Boolean));
    urls.forEach((url) => URL.revokeObjectURL(url));
  };

  const isRateLimitError = (err: unknown): boolean => {
    if (!err || typeof err !== "object") return false;
    const anyErr = err as { status?: number; message?: string };
    return anyErr.status === 429 || anyErr.message?.includes("429") || anyErr.message?.includes("rate limit") === true;
  };

  const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> =>
    Promise.race([
      promise,
      new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`Request timeout after ${ms / 1000}s`)), ms)),
    ]);

  const detectPageNumbersBatch = async (imagesBase64: string[], imageIds: string[], retryCount = 0): Promise<number[][]> => {
    console.log(`Sending batch of ${imagesBase64.length} images to Gemini 2.5...`);

    try {
      const apiKey = getApiKey();
      if (!apiKey) {
        throw new Error("No API Key configured");
      }

      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

      const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [
        {
          text: `You are analyzing ${imagesBase64.length} book page images. For EACH image, extract the printed page number(s).
RULES:
- Return page numbers as integers.
- If no page number is visible, return an empty array.
- Ignore chapter numbers.
Respond with a JSON array containing ${imagesBase64.length} sub-arrays.
Example: [[42], [14, 15], []]
RESPOND ONLY WITH THE JSON ARRAY.`,
        },
      ];

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

      const cleanText = text.replace(/```json/g, "").replace(/```/g, "").trim();
      const jsonMatch = cleanText.match(/\[[\s\S]*\]/);

      if (!jsonMatch) {
        return imagesBase64.map(() => []);
      }

      const parsed = JSON.parse(jsonMatch[0]);
      if (!Array.isArray(parsed)) {
        return imagesBase64.map(() => []);
      }

      return parsed.map((item: unknown) => {
        if (Array.isArray(item)) {
          return item.filter((n): n is number => typeof n === "number" && Number.isInteger(n) && n > 0);
        }
        if (typeof item === "number" && Number.isInteger(item) && item > 0) {
          return [item];
        }
        return [];
      });
    } catch (error) {
      const err = error as { message?: string };
      if (isRateLimitError(error) && retryCount < MAX_RETRIES) {
        const rotated = rotateApiKey();
        const waitTime = rotated ? 3000 : INITIAL_RETRY_DELAY + retryCount * 5000;

        setImages((prev) =>
          prev.map((img) =>
            imageIds.includes(img.id) ? { ...img, error: `Rate limited. Waiting ${waitTime / 1000}s...` } : img,
          ),
        );

        await sleep(waitTime);
        return detectPageNumbersBatch(imagesBase64, imageIds, retryCount + 1);
      }
      throw new Error(err.message || "Failed to detect page numbers");
    }
  };

  const getExistingPageNumbers = useCallback((allImages: BookImage[], excludeIds?: string[]): Set<number> => {
    const pages = new Set<number>();
    allImages.forEach((img) => {
      if (excludeIds?.includes(img.id)) return;
      if (img.status === "completed" && img.pageNumbers.length > 0) {
        img.pageNumbers.forEach((p) => pages.add(p));
      }
    });
    return pages;
  }, []);

  const hasAnyDuplicatePage = useCallback((newPageNumbers: number[], existingPages: Set<number>): number | null => {
    for (const page of newPageNumbers) {
      if (existingPages.has(page)) return page;
    }
    return null;
  }, []);

  const finalizeImageResult = useCallback(
    (img: BookImage, pageNumbers: number[], existingPages: Set<number>, manualOnFailure = false): BookImage => {
      if (pageNumbers.length === 0) {
        return {
          ...img,
          status: "error",
          confidence: 42,
          manualRequired: manualOnFailure,
          error: manualOnFailure ? "Manual page number required" : "Low confidence - no page detected",
        };
      }

      const duplicatePage = hasAnyDuplicatePage(pageNumbers, existingPages);
      if (duplicatePage !== null) {
        return {
          ...img,
          status: "error",
          pageNumbers: [],
          confidence: 100,
          manualRequired: false,
          error: `Skipped: Page ${duplicatePage} already exists`,
        };
      }

      pageNumbers.forEach((p) => existingPages.add(p));

      return {
        ...img,
        status: "completed",
        pageNumbers,
        confidence: pageNumbers.length > 1 ? 97 : 91,
        manualRequired: false,
        error: undefined,
      };
    },
    [hasAnyDuplicatePage],
  );

  const processBatch = useCallback(
    async (batchImages: BookImage[], existingPages: Set<number>, manualOnFailure = false): Promise<BookImage[]> => {
      const base64Results = await Promise.all(
        batchImages.map(async (image) => {
          try {
            return {
              id: image.id,
              base64: await fileToBase64(image.file),
            };
          } catch (error) {
            console.error("Failed to encode image:", error);
            return {
              id: image.id,
              base64: null,
            };
          }
        }),
      );

      const validPayloads = base64Results.filter((item): item is { id: string; base64: string } => typeof item.base64 === "string");
      const failedIds = base64Results.filter((item) => item.base64 === null).map((item) => item.id);

      if (validPayloads.length === 0) {
        return batchImages.map((img) => ({
          ...img,
          status: "error",
          confidence: 42,
          manualRequired: manualOnFailure,
          error: manualOnFailure ? "Manual page number required" : "Failed to read image",
        }));
      }

      try {
        await sleep(0);
        const batchResults = await detectPageNumbersBatch(
          validPayloads.map((item) => item.base64),
          validPayloads.map((item) => item.id),
        );

        return batchImages.map((img) => {
          if (failedIds.includes(img.id)) {
            return {
              ...img,
              status: "error",
              confidence: 42,
              manualRequired: manualOnFailure,
              error: manualOnFailure ? "Manual page number required" : "Failed to read image",
            };
          }

          const resultIdx = validPayloads.findIndex((item) => item.id === img.id);
          if (resultIdx === -1) {
            return {
              ...img,
              status: "error",
              confidence: 42,
              manualRequired: manualOnFailure,
              error: manualOnFailure ? "Manual page number required" : "Processing error",
            };
          }

          return finalizeImageResult(img, batchResults[resultIdx] || [], existingPages, manualOnFailure);
        });
      } catch (error) {
        return batchImages.map((img) => ({
          ...img,
          status: "error",
          confidence: 42,
          manualRequired: manualOnFailure,
          error: manualOnFailure ? "Manual page number required" : error instanceof Error ? error.message : "Unknown error",
        }));
      }
    },
    [detectPageNumbersBatch, finalizeImageResult],
  );

  const runProcessing = useCallback(
    async (targetImages: BookImage[], manualOnFailure = false) => {
      if (targetImages.length === 0) return;

      setIsProcessing(true);
      abortRef.current = false;
      setProcessingState({
        total: targetImages.length,
        completed: 0,
        processing: 0,
        errors: 0,
      });

      const existingPages = getExistingPageNumbers(images, targetImages.map((img) => img.id));
      const batches: BookImage[][] = [];
      for (let i = 0; i < targetImages.length; i += BATCH_SIZE) {
        batches.push(targetImages.slice(i, i + BATCH_SIZE));
      }

      let completedCount = 0;
      let errorCount = 0;

      for (let batchIdx = 0; batchIdx < batches.length; batchIdx += 1) {
        if (abortRef.current) break;
        const batch = batches[batchIdx];

        setImages((prev) =>
          prev.map((img) =>
            batch.some((candidate) => candidate.id === img.id)
              ? { ...img, status: "processing", error: undefined, manualRequired: false }
              : img,
          ),
        );
        setProcessingState((prev) => ({ ...prev, processing: batch.length }));

        const results = await processBatch(batch, existingPages, manualOnFailure);

        setImages((prev) =>
          prev.map((img) => {
            const result = results.find((entry) => entry.id === img.id);
            return result || img;
          }),
        );

        completedCount += results.filter((result) => result.status === "completed").length;
        errorCount += results.filter((result) => result.status === "error").length;

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
    },
    [getExistingPageNumbers, images, processBatch],
  );

  const addImages = useCallback(async (files: File[]) => {
    setIsPreparingImages(true);
    setPreparingState({ total: files.length, completed: 0 });

    const autoCropEnabled = getAutoCropEnabled();
    const newImages: BookImage[] = [];

    try {
      for (const [index, file] of files.entries()) {
        const geminiCompressed = await compressImage(file, 800, 0.75);
        const geminiDataUrl = autoCropEnabled ? await autoCrop(geminiCompressed.dataUrl) : geminiCompressed.dataUrl;
        const pdfCompressed = await compressImage(file, 1200, 0.85);
        const pdfDataUrl = autoCropEnabled ? await autoCrop(pdfCompressed.dataUrl) : pdfCompressed.dataUrl;

        const originalPreview = URL.createObjectURL(file);
        const croppedPreview = dataUrlToObjectUrl(geminiDataUrl);
        const processingFile = dataUrlToFile(geminiDataUrl, file.name);

        const newImage: BookImage = {
          id: `${Date.now()}-${index}-${Math.random().toString(36).slice(2, 9)}`,
          file: processingFile,
          preview: croppedPreview,
          originalPreview,
          croppedPreview,
          pdfPreview: pdfDataUrl,
          cropApplied: geminiDataUrl !== geminiCompressed.dataUrl,
          status: "pending",
          pageNumbers: [],
          confidence: undefined,
          manualRequired: false,
        };

        newImages.push(newImage);
        setImages((prev) => [...prev, newImage]);
        setPreparingState({ total: files.length, completed: index + 1 });
        await sleep(0);
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
    await runProcessing(pendingImages, false);
  }, [images, runProcessing]);

  const stopProcessing = useCallback(() => {
    abortRef.current = true;
    setIsProcessing(false);
  }, []);

  const retryFailedImages = useCallback(async () => {
    await runProcessing(failedImages, true);
  }, [failedImages, runProcessing]);

  const retryAllImages = useCallback(async () => {
    const retryable = images.filter((img) => img.status === "pending" || isFailedImage(img));
    await runProcessing(retryable, true);
  }, [images, runProcessing]);

  const rescanImage = useCallback(
    async (imageId: string) => {
      const targetImage = images.find((img) => img.id === imageId);
      if (!targetImage) return;
      await runProcessing([targetImage], true);
    },
    [images, runProcessing],
  );

  const setManualPageNumber = useCallback(
    (imageId: string, pageValue: string) => {
      const parsed = Number.parseInt(pageValue.trim(), 10);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        return { ok: false, message: "Enter a valid page number" };
      }

      const existingPages = getExistingPageNumbers(images, [imageId]);
      if (existingPages.has(parsed)) {
        return { ok: false, message: `Page ${parsed} already exists` };
      }

      setImages((prev) =>
        prev.map((img) =>
          img.id === imageId
            ? {
                ...img,
                status: "completed",
                pageNumbers: [parsed],
                confidence: 100,
                manualRequired: false,
                error: undefined,
              }
            : img,
        ),
      );

      return { ok: true, message: "Page saved" };
    },
    [getExistingPageNumbers, images],
  );

  const getPageRange = useCallback((): PageRange | null => {
    const allPages = images.filter((img) => img.status === "completed").flatMap((img) => img.pageNumbers);
    if (allPages.length === 0) return null;
    const uniquePages = [...new Set(allPages)].sort((a, b) => a - b);
    const min = Math.min(...uniquePages);
    const max = Math.max(...uniquePages);
    const missing: number[] = [];
    for (let i = min; i <= max; i += 1) {
      if (!uniquePages.includes(i)) missing.push(i);
    }
    return { min, max, missing };
  }, [images]);

  const getSortedImages = useCallback(
    () =>
      [...images]
        .filter((img) => img.status === "completed" && img.pageNumbers.length > 0)
        .sort((a, b) => Math.min(...a.pageNumbers) - Math.min(...b.pageNumbers)),
    [images],
  );

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
      const aTime = parseInt(a.id.split("-")[0], 10);
      const bTime = parseInt(b.id.split("-")[0], 10);
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

  return {
    images,
    failedImages,
    isProcessing,
    isPreparingImages,
    preparingState,
    processingState,
    addImages,
    removeImage,
    clearAll,
    startProcessing,
    stopProcessing,
    retryFailedImages,
    retryAllImages,
    getPageRange,
    getSortedImages,
    removeDuplicates,
    rescanImage,
    setManualPageNumber,
  };
}
