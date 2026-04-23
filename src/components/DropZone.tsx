import { useCallback, useRef, useState } from 'react';
import { Upload, Camera, FolderOpen } from 'lucide-react';

interface DropZoneProps {
  onFilesAdded: (files: File[]) => void;
  disabled?: boolean;
  helperText?: string;
}

export function DropZone({ onFilesAdded, disabled, helperText }: DropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback((files: FileList | null) => {
    if (!files || disabled) return;

    const imageFiles = Array.from(files).filter((file) => file.type.startsWith('image/'));
    if (imageFiles.length > 0) {
      onFilesAdded(imageFiles);
    }
  }, [onFilesAdded, disabled]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (!disabled) setIsDragging(true);
  }, [disabled]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  return (
    <div
      className={`
        upload-breathing relative overflow-hidden rounded-[24px] border-2 border-dashed
        bg-[radial-gradient(circle_at_top,rgba(232,184,75,0.12),transparent_45%),hsl(var(--card))]
        transition-all duration-300
        ${isDragging ? 'border-[hsl(var(--accent))] bg-[hsl(var(--secondary))]' : 'border-[hsl(var(--accent))]/60 hover:border-[hsl(var(--accent))]'}
        ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}
      `}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={() => !disabled && fileInputRef.current?.click()}
    >
      <div className="relative flex flex-col items-center justify-center gap-4 px-6 py-12 md:py-16">
        <div
          className={`
            rounded-full border border-[hsl(var(--accent))]/30 bg-white p-4 transition-colors duration-200
            ${isDragging ? 'bg-[hsl(var(--accent))]/10' : ''}
          `}
        >
          <Upload
            className={`
              h-8 w-8 transition-colors duration-200
              ${isDragging ? 'text-[hsl(var(--accent))]' : 'text-muted-foreground'}
            `}
          />
        </div>

        <div className="space-y-1 text-center">
          <h3 className="max-w-[420px] font-heading text-[22px] leading-tight text-foreground">
            Drop book pages here
          </h3>
          <p className="text-sm text-muted-foreground">
            or click to browse • JPG, PNG, WEBP
          </p>
          {helperText && (
            <p className="text-xs text-[hsl(var(--accent))]">
              {helperText}
            </p>
          )}
        </div>

        <div className="mt-2 flex items-center gap-3">
          <button
            type="button"
            disabled={disabled}
            onClick={(e) => {
              e.stopPropagation();
              cameraInputRef.current?.click();
            }}
            className="flex items-center gap-2 rounded-full bg-[linear-gradient(135deg,#e8b84b,#c9a84c)] px-4 py-2 text-sm font-medium text-[#1A1A1A] transition-opacity duration-200 hover:opacity-90 active:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Camera className="h-4 w-4" />
            Take Photo
          </button>

          <button
            type="button"
            disabled={disabled}
            onClick={(e) => {
              e.stopPropagation();
              fileInputRef.current?.click();
            }}
            className="flex items-center gap-2 rounded-full border border-border bg-white px-4 py-2 text-sm font-medium text-foreground transition-colors duration-200 hover:bg-[hsl(var(--secondary))] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <FolderOpen className="h-4 w-4" />
            Browse
          </button>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*"
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
        onClick={(e) => {
          e.currentTarget.value = "";
        }}
        disabled={disabled}
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
        onClick={(e) => {
          e.currentTarget.value = "";
        }}
        disabled={disabled}
      />
    </div>
  );
}
