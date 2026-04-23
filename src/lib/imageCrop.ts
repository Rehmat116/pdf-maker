const PADDING = 8;
const BRIGHTNESS_THRESHOLD = 16;
const COLOR_DISTANCE_THRESHOLD = 42;
const CONTENT_RATIO_THRESHOLD = 0.9;
const MIN_EDGE_CONTENT_PIXELS = 3;

export interface AutoCropResult {
  file: File;
  originalPreview: string;
  croppedPreview: string;
  cropApplied: boolean;
}

const getBrightness = (r: number, g: number, b: number) => (r + g + b) / 3;

const getPixel = (data: Uint8ClampedArray, width: number, x: number, y: number) => {
  const index = (y * width + x) * 4;
  return {
    r: data[index],
    g: data[index + 1],
    b: data[index + 2],
    a: data[index + 3],
  };
};

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
    const pixel = getPixel(data, width, x, y);
    totalR += pixel.r;
    totalG += pixel.g;
    totalB += pixel.b;
  });

  return {
    r: totalR / samplePoints.length,
    g: totalG / samplePoints.length,
    b: totalB / samplePoints.length,
  };
};

const isContentPixel = (
  data: Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
  background: { r: number; g: number; b: number },
) => {
  const pixel = getPixel(data, width, x, y);
  if (pixel.a === 0) {
    return false;
  }

  const brightnessDelta = Math.abs(getBrightness(pixel.r, pixel.g, pixel.b) - getBrightness(background.r, background.g, background.b));
  const colorDelta = Math.abs(pixel.r - background.r) + Math.abs(pixel.g - background.g) + Math.abs(pixel.b - background.b);

  return brightnessDelta > BRIGHTNESS_THRESHOLD || colorDelta > COLOR_DISTANCE_THRESHOLD;
};

const hasContentOnRow = (
  data: Uint8ClampedArray,
  width: number,
  y: number,
  background: { r: number; g: number; b: number },
) => {
  let hits = 0;
  for (let x = 0; x < width; x += 1) {
    if (isContentPixel(data, width, x, y, background)) {
      hits += 1;
      if (hits >= MIN_EDGE_CONTENT_PIXELS) {
        return true;
      }
    }
  }

  return false;
};

const hasContentOnColumn = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  background: { r: number; g: number; b: number },
) => {
  let hits = 0;
  for (let y = 0; y < height; y += 1) {
    if (isContentPixel(data, width, x, y, background)) {
      hits += 1;
      if (hits >= MIN_EDGE_CONTENT_PIXELS) {
        return true;
      }
    }
  }

  return false;
};

const findBoundingBox = (data: Uint8ClampedArray, width: number, height: number) => {
  const background = sampleBackground(data, width, height);

  let top = 0;
  while (top < height && !hasContentOnRow(data, width, top, background)) {
    top += 1;
  }

  let bottom = height - 1;
  while (bottom >= top && !hasContentOnRow(data, width, bottom, background)) {
    bottom -= 1;
  }

  let left = 0;
  while (left < width && !hasContentOnColumn(data, width, height, left, background)) {
    left += 1;
  }

  let right = width - 1;
  while (right >= left && !hasContentOnColumn(data, width, height, right, background)) {
    right -= 1;
  }

  if (left >= right || top >= bottom) {
    return null;
  }

  const croppedWidth = right - left + 1;
  const croppedHeight = bottom - top + 1;
  const croppedRatio = (croppedWidth * croppedHeight) / (width * height);

  if (croppedRatio > CONTENT_RATIO_THRESHOLD) {
    return null;
  }

  return {
    x: Math.max(0, left - PADDING),
    y: Math.max(0, top - PADDING),
    width: Math.min(width - Math.max(0, left - PADDING), croppedWidth + PADDING * 2),
    height: Math.min(height - Math.max(0, top - PADDING), croppedHeight + PADDING * 2),
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
