const PADDING = 8;
const BRIGHTNESS_THRESHOLD = 30;
const CONTENT_RATIO_THRESHOLD = 0.9;

export interface AutoCropResult {
  file: File;
  originalPreview: string;
  croppedPreview: string;
  cropApplied: boolean;
}

const getBrightness = (r: number, g: number, b: number) => (r + g + b) / 3;

const sampleBackground = (data: Uint8ClampedArray, width: number, height: number) => {
  const samplePoints = [
    [0, 0],
    [width - 1, 0],
    [0, height - 1],
    [width - 1, height - 1],
    [Math.floor(width / 2), 0],
    [Math.floor(width / 2), height - 1],
    [0, Math.floor(height / 2)],
    [width - 1, Math.floor(height / 2)],
  ];

  let totalR = 0;
  let totalG = 0;
  let totalB = 0;

  samplePoints.forEach(([x, y]) => {
    const index = (y * width + x) * 4;
    totalR += data[index];
    totalG += data[index + 1];
    totalB += data[index + 2];
  });

  return {
    r: totalR / samplePoints.length,
    g: totalG / samplePoints.length,
    b: totalB / samplePoints.length,
  };
};

const findBoundingBox = (data: Uint8ClampedArray, width: number, height: number) => {
  const bg = sampleBackground(data, width, height);
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let contentPixels = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const r = data[index];
      const g = data[index + 1];
      const b = data[index + 2];
      const alpha = data[index + 3];
      const brightnessDelta = Math.abs(getBrightness(r, g, b) - getBrightness(bg.r, bg.g, bg.b));
      const colorDelta = Math.abs(r - bg.r) + Math.abs(g - bg.g) + Math.abs(b - bg.b);

      if (alpha > 0 && (brightnessDelta > BRIGHTNESS_THRESHOLD || colorDelta > BRIGHTNESS_THRESHOLD * 3)) {
        contentPixels += 1;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  if (maxX === -1 || maxY === -1) {
    return null;
  }

  const contentRatio = contentPixels / (width * height);
  if (contentRatio > CONTENT_RATIO_THRESHOLD) {
    return null;
  }

  return {
    x: Math.max(0, minX - PADDING),
    y: Math.max(0, minY - PADDING),
    width: Math.min(width - Math.max(0, minX - PADDING), maxX - minX + 1 + PADDING * 2),
    height: Math.min(height - Math.max(0, minY - PADDING), maxY - minY + 1 + PADDING * 2),
  };
};

const canvasToBlob = (canvas: HTMLCanvasElement, type: string) =>
  new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Failed to create image blob"));
        return;
      }
      resolve(blob);
    }, type, 0.92);
  });

export async function autoCropImage(file: File): Promise<AutoCropResult> {
  const originalPreview = URL.createObjectURL(file);

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("Failed to load image"));
      element.src = originalPreview;
    });

    const sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = img.naturalWidth;
    sourceCanvas.height = img.naturalHeight;

    const sourceCtx = sourceCanvas.getContext("2d", { willReadFrequently: true });
    if (!sourceCtx) {
      throw new Error("Failed to read image pixels");
    }

    sourceCtx.drawImage(img, 0, 0);
    const imageData = sourceCtx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
    const bounds = findBoundingBox(imageData.data, sourceCanvas.width, sourceCanvas.height);

    if (!bounds) {
      return {
        file,
        originalPreview,
        croppedPreview: originalPreview,
        cropApplied: false,
      };
    }

    const cropCanvas = document.createElement("canvas");
    cropCanvas.width = bounds.width;
    cropCanvas.height = bounds.height;

    const cropCtx = cropCanvas.getContext("2d");
    if (!cropCtx) {
      throw new Error("Failed to crop image");
    }

    cropCtx.drawImage(
      sourceCanvas,
      bounds.x,
      bounds.y,
      bounds.width,
      bounds.height,
      0,
      0,
      bounds.width,
      bounds.height,
    );

    const blob = await canvasToBlob(cropCanvas, file.type || "image/jpeg");
    const croppedFile = new File([blob], file.name, {
      type: blob.type || file.type || "image/jpeg",
      lastModified: file.lastModified,
    });
    const croppedPreview = URL.createObjectURL(croppedFile);

    sourceCanvas.width = 0;
    sourceCanvas.height = 0;
    cropCanvas.width = 0;
    cropCanvas.height = 0;

    return {
      file: croppedFile,
      originalPreview,
      croppedPreview,
      cropApplied: true,
    };
  } catch (error) {
    console.error("Auto crop failed:", error);
    return {
      file,
      originalPreview,
      croppedPreview: originalPreview,
      cropApplied: false,
    };
  }
}
