import { Play, Square, Download, Trash2, Loader2, RefreshCw } from 'lucide-react';
import { BookImage } from '@/types/book';
import { Button } from '@/components/ui/button';

interface ActionBarProps {
  images: BookImage[];
  isProcessing: boolean;
  onStartProcessing: () => void;
  onStopProcessing: () => void;
  onDownloadPDF: () => void;
  onClearAll: () => void;
  onRemoveDuplicates: () => void;
  isGeneratingPDF: boolean;
}

export function ActionBar({
  images,
  isProcessing,
  onStartProcessing,
  onStopProcessing,
  onDownloadPDF,
  onClearAll,
  onRemoveDuplicates,
  isGeneratingPDF,
}: ActionBarProps) {
  const pendingCount = images.filter((img) => img.status === 'pending').length;
  const completedCount = images.filter((img) => img.status === 'completed' && img.pageNumbers.length > 0).length;

  if (images.length === 0) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border/90 bg-background/90 backdrop-blur-xl">
      <div className="mx-auto flex h-[60px] max-w-6xl items-center gap-3 px-4">
        {pendingCount > 0 && !isProcessing && (
          <Button onClick={onStartProcessing} className="gap-2 rounded-full">
            <Play className="h-4 w-4" />
            Scan {pendingCount} Images
          </Button>
        )}

        {isProcessing && (
          <Button onClick={onStopProcessing} variant="destructive" className="gap-2 rounded-full">
            <Square className="h-4 w-4" />
            Stop
          </Button>
        )}

        {completedCount > 0 && !isProcessing && (
          <Button
            onClick={onDownloadPDF}
            disabled={isGeneratingPDF}
            className="button-shimmer gap-2 rounded-full border-0 bg-[linear-gradient(135deg,#e8b84b,#c9a84c)] px-5 text-[#1A1A1A] shadow-[0_16px_30px_-18px_rgba(201,168,76,0.9)] hover:opacity-95"
          >
            {isGeneratingPDF ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Download className="h-4 w-4" />
                Make PDF ({completedCount})
              </>
            )}
          </Button>
        )}

        <div className="flex-1" />

        {!isProcessing && completedCount > 0 && (
          <Button onClick={onRemoveDuplicates} variant="ghost" size="sm" className="gap-2 text-muted-foreground">
            <RefreshCw className="h-4 w-4" />
            Remove Duplicates
          </Button>
        )}

        {!isProcessing && (
          <Button onClick={onClearAll} variant="ghost" size="sm" className="gap-2 text-muted-foreground">
            <Trash2 className="h-4 w-4" />
            Clear
          </Button>
        )}

        <span className="text-xs text-muted-foreground">
          {images.length} total • {completedCount} ready
        </span>
      </div>
    </div>
  );
}
