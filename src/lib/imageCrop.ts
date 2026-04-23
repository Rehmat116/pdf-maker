export interface CompressionResult {
  dataUrl: string;
  width: number;
  height: number;
  originalSize: number;
  compressedSize: number;
}

export function compressImage(file: File, maxDim = 800, quality = 0.75): Promise<CompressionResult> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      const canvas = document.createElement('canvas');
      let w = img.width;
      let h = img.height;

      if (w > maxDim || h > maxDim) {
        if (w > h) {
          h = (h * maxDim) / w;
          w = maxDim;
        } else {
          w = (w * maxDim) / h;
          h = maxDim;
        }
      }

      canvas.width = Math.round(w);
      canvas.height = Math.round(h);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('Failed to get canvas context'));
        return;
      }

      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      const compressedSize = Math.round((dataUrl.length * 3) / 4);

      console.debug(
        `[compressImage] ${file.name}: ${Math.round(file.size / 1024)}KB -> ${Math.round(compressedSize / 1024)}KB`,
      );

      canvas.width = 0;
      canvas.height = 0;
      URL.revokeObjectURL(objectUrl);

      resolve({
        dataUrl,
        width: Math.round(w),
        height: Math.round(h),
        originalSize: file.size,
        compressedSize,
      });
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Failed to load image'));
    };

    img.src = objectUrl;
  });
}

export function autoCrop(base64Image: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        reject(new Error('Failed to get crop canvas context'));
        return;
      }

      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;

      const corners = [
        [0, 0],
        [canvas.width - 5, 0],
        [0, canvas.height - 5],
        [canvas.width - 5, canvas.height - 5],
      ];

      let bgR = 0;
      let bgG = 0;
      let bgB = 0;

      corners.forEach(([x, y]) => {
        const i = (y * canvas.width + x) * 4;
        bgR += data[i];
        bgG += data[i + 1];
        bgB += data[i + 2];
      });

      bgR /= 4;
      bgG /= 4;
      bgB /= 4;

      let minX = canvas.width;
      let minY = canvas.height;
      let maxX = 0;
      let maxY = 0;

      for (let y = 0; y < canvas.height; y += 1) {
        for (let x = 0; x < canvas.width; x += 1) {
          const i = (y * canvas.width + x) * 4;
          const diff =
            Math.abs(data[i] - bgR) +
            Math.abs(data[i + 1] - bgG) +
            Math.abs(data[i + 2] - bgB);

          if (diff > 30) {
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
          }
        }
      }

      const pad = 12;
      minX = Math.max(0, minX - pad);
      minY = Math.max(0, minY - pad);
      maxX = Math.min(canvas.width, maxX + pad);
      maxY = Math.min(canvas.height, maxY + pad);

      const cropW = maxX - minX;
      const cropH = maxY - minY;

      const originalArea = canvas.width * canvas.height;
      const croppedArea = cropW * cropH;
      if (cropW <= 0 || cropH <= 0 || croppedArea > originalArea * 0.9) {
        resolve(base64Image);
        return;
      }

      const out = document.createElement('canvas');
      out.width = cropW;
      out.height = cropH;
      const outCtx = out.getContext('2d');
      if (!outCtx) {
        reject(new Error('Failed to get output crop context'));
        return;
      }

      outCtx.drawImage(canvas, minX, minY, cropW, cropH, 0, 0, cropW, cropH);
      const cropped = out.toDataURL('image/jpeg', 0.9);

      canvas.width = 0;
      canvas.height = 0;
      out.width = 0;
      out.height = 0;

      resolve(cropped);
    };

    img.onerror = () => reject(new Error('Failed to load base64 image'));
    img.src = base64Image;
  });
}

export function dataUrlToFile(dataUrl: string, filename: string) {
  const [meta, content] = dataUrl.split(',');
  const mimeMatch = meta.match(/data:(.*?);base64/);
  const mime = mimeMatch?.[1] || 'image/jpeg';
  const bytes = atob(content);
  const array = new Uint8Array(bytes.length);

  for (let i = 0; i < bytes.length; i += 1) {
    array[i] = bytes.charCodeAt(i);
  }

  return new File([array], filename.replace(/\.[^.]+$/, '.jpg'), { type: mime });
}

export function dataUrlToObjectUrl(dataUrl: string) {
  return URL.createObjectURL(dataUrlToFile(dataUrl, `preview-${Date.now()}.jpg`));
}
