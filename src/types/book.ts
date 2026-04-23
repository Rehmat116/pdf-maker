export interface BookImage {
  id: string;
  file: File;
  preview: string;
  originalPreview: string;
  croppedPreview: string;
  pdfPreview: string;
  cropApplied: boolean;
  status: 'pending' | 'processing' | 'completed' | 'error';
  pageNumbers: number[];
  confidence?: number;
  manualRequired?: boolean;
  error?: string;
}

export interface ProcessingState {
  total: number;
  completed: number;
  processing: number;
  errors: number;
}

export interface PageRange {
  min: number;
  max: number;
  missing: number[];
}
