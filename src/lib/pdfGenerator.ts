import { jsPDF } from 'jspdf';
import { BookImage } from '@/types/book';

// Mobile-safe PDF generator with sequential processing
export async function generatePDF(
  images: BookImage[],
  onProgress?: (current: number, total: number) => void
): Promise<Blob> {
  // Sort images by first page number
  const sortedImages = [...images]
    .filter(img => img.status === 'completed' && img.pageNumbers.length > 0)
    .sort((a, b) => {
      const aMin = Math.min(...a.pageNumbers);
      const bMin = Math.min(...b.pageNumbers);
      return aMin - bMin;
    });

  if (sortedImages.length === 0) {
    throw new Error('No valid images to compile');
  }

  // Create PDF
  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
  });

  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();

  // Sequential processing to prevent memory overflow
  for (let i = 0; i < sortedImages.length; i++) {
    const image = sortedImages[i];
    
    if (i > 0) {
      pdf.addPage();
    }

    try {
      // Load and compress image with memory-safe pipeline
      const compressedData = await compressForPDF(image.pdfPreview || image.preview);
      
      // Calculate dimensions to fit page
      const aspectRatio = compressedData.width / compressedData.height;
      let width = pageWidth;
      let height = width / aspectRatio;

      if (height > pageHeight) {
        height = pageHeight;
        width = height * aspectRatio;
      }

      // Center the image
      const x = (pageWidth - width) / 2;
      const y = (pageHeight - height) / 2;

      pdf.addImage(compressedData.dataUrl, 'JPEG', x, y, width, height);

      // Force memory cleanup
      compressedData.dataUrl = '';
      
      if (onProgress) {
        onProgress(i + 1, sortedImages.length);
      }

      // Small delay to allow GC on mobile
      if (i % 10 === 0 && i > 0) {
        await new Promise(r => setTimeout(r, 50));
      }
    } catch (error) {
      console.error(`Failed to add image ${i + 1}:`, error);
    }
  }

  return pdf.output('blob');
}

// Memory-efficient image compression for PDF
async function compressForPDF(src: string): Promise<{ dataUrl: string; width: number; height: number }> {
  const MAX_DIMENSION = 1200;
  const QUALITY = 0.85;

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    
    img.onload = () => {
      let width = img.width;
      let height = img.height;

      // Resize if too large
      if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
        if (width > height) {
          height = Math.round((height * MAX_DIMENSION) / width);
          width = MAX_DIMENSION;
        } else {
          width = Math.round((width * MAX_DIMENSION) / height);
          height = MAX_DIMENSION;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Failed to get canvas context'));
        return;
      }
      
      ctx.drawImage(img, 0, 0, width, height);
      const dataUrl = canvas.toDataURL('image/jpeg', QUALITY);

      // Cleanup canvas to free memory
      canvas.width = 0;
      canvas.height = 0;

      resolve({ dataUrl, width, height });
    };
    
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = src;
  });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
