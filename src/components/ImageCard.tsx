import React from 'react';
import { X, Loader2, AlertCircle, CheckCircle2, FileText, RefreshCw, Eye } from 'lucide-react';
import { BookImage } from '@/types/book';
import { Button } from '@/components/ui/button';

interface ImageCardProps {
  image: BookImage;
  index?: number;
  onRemove: (id: string) => void;
  onRescan?: (id: string) => void;
  onPreview?: (id: string) => void;
  onManualSave?: (id: string, pageValue: string) => { ok: boolean; message: string };
}

const ImageCardComponent = ({ image, index = 0, onRemove, onRescan, onPreview, onManualSave }: ImageCardProps) => {
  const [showCropped, setShowCropped] = React.useState(true);
  const [manualPage, setManualPage] = React.useState('');
  const [isVisible, setIsVisible] = React.useState(false);
  const cardRef = React.useRef<HTMLDivElement | null>(null);
  const isRescannable = image.status === 'error' && !image.error?.startsWith('Skipped:');

  React.useEffect(() => {
    const node = cardRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setIsVisible(true);
            observer.disconnect();
          }
        });
      },
      { rootMargin: '120px' },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const getStatusIcon = () => {
    switch (image.status) {
      case 'processing':
        return <Loader2 className="w-3.5 h-3.5 animate-spin text-foreground" />;
      case 'completed':
        return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />;
      case 'error':
        return <AlertCircle className="w-3.5 h-3.5 text-red-500" />;
      default:
        return <FileText className="w-3.5 h-3.5 text-muted-foreground" />;
    }
  };

  const getStatusText = () => {
    switch (image.status) {
      case 'processing':
        return 'Scanning...';
      case 'completed':
        return image.pageNumbers.length > 0 ? `Page ${image.pageNumbers.join(', ')}` : 'No page found';
      case 'error':
        return image.error || 'Error';
      default:
        return 'Pending';
    }
  };

  return (
    <div
      ref={cardRef}
      className={`
        group relative overflow-hidden rounded-[12px]
        border border-border bg-card shadow-[0_18px_40px_-28px_rgba(26,26,26,0.35)] transition-all duration-300
        hover:-translate-y-1 hover:shadow-[0_24px_45px_-24px_rgba(26,26,26,0.25)]
        ${image.status === 'completed' && image.pageNumbers.length > 0 ? 'border-[hsl(var(--accent))]/40' : image.status === 'error' ? 'border-red-300' : ''}
      `}
      style={{ animationDelay: `${index * 50}ms` }}
    >
      <div
        role="button"
        tabIndex={0}
        className="relative block aspect-[4/3] w-full overflow-hidden bg-[hsl(var(--secondary))]"
        onClick={() => onPreview?.(image.id)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onPreview?.(image.id);
          }
        }}
      >
        {isVisible ? (
          <img
            src={showCropped ? image.croppedPreview : image.originalPreview}
            alt="Book page"
            className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
            Loading preview...
          </div>
        )}

        {image.status === 'processing' && (
          <div className="absolute inset-0 bg-background/80 flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-foreground" />
          </div>
        )}

        {isRescannable && onRescan && (
          <button
            onClick={(event) => {
              event.stopPropagation();
              onRescan(image.id);
            }}
            className="absolute inset-0 bg-background/70 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-150"
          >
            <RefreshCw className="w-5 h-5 text-foreground" />
          </button>
        )}

        <button
          onClick={(event) => {
            event.stopPropagation();
            onRemove(image.id);
          }}
          className="absolute top-1.5 right-1.5 p-1 rounded bg-background/80 opacity-0 group-hover:opacity-100 hover:bg-red-500 hover:text-white transition-all duration-150 z-10"
        >
          <X className="w-3.5 h-3.5" />
        </button>

        {image.manualRequired && (
          <div className="absolute top-1.5 left-1.5 rounded-full bg-red-500 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-white">
            Manual
          </div>
        )}

        {!image.manualRequired && image.status === 'completed' && image.pageNumbers.length > 0 && (
          <div className="absolute top-1.5 left-1.5">
            <div className="rounded-full bg-white/95 px-2 py-1 text-xs font-medium text-[hsl(var(--foreground))] shadow-sm">
              {image.pageNumbers.length === 1 ? image.pageNumbers[0] : `${image.pageNumbers[0]}-${image.pageNumbers[image.pageNumbers.length - 1]}`}
            </div>
          </div>
        )}
      </div>

      <div className="space-y-3 p-3">
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" variant={showCropped ? 'default' : 'outline'} onClick={() => setShowCropped(true)} className="h-8 rounded-full px-3 text-xs">
            Cropped
          </Button>
          <Button type="button" size="sm" variant={!showCropped ? 'default' : 'outline'} onClick={() => setShowCropped(false)} className="h-8 rounded-full px-3 text-xs">
            Original
          </Button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onPreview?.(image.id);
            }}
            className="ml-auto rounded-full p-2 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
            aria-label="Open preview"
          >
            <Eye className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          {getStatusIcon()}
          <span
            className={`
              text-xs truncate flex-1
              ${image.status === 'completed' && image.pageNumbers.length > 0 ? 'text-foreground' : image.status === 'error' ? 'text-red-500' : 'text-muted-foreground'}
            `}
          >
            {getStatusText()}
          </span>
          {typeof image.confidence === 'number' && (
            <span className={`font-mono text-[11px] ${image.confidence < 60 ? 'text-red-500' : 'text-muted-foreground'}`}>
              {image.confidence}%
            </span>
          )}
        </div>

        {image.manualRequired && onManualSave && (
          <div className="flex gap-2">
            <input
              type="number"
              min={1}
              value={manualPage}
              onChange={(event) => setManualPage(event.target.value)}
              placeholder="Page #"
              className="h-9 w-full rounded-full border border-red-200 bg-red-50 px-3 text-sm text-foreground outline-none"
            />
            <Button
              type="button"
              size="sm"
              className="h-9 rounded-full px-4"
              onClick={() => {
                const result = onManualSave(image.id, manualPage);
                if (result.ok) {
                  setManualPage('');
                }
              }}
            >
              Save
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

export const ImageCard = React.memo(ImageCardComponent, (prevProps, nextProps) => (
  prevProps.image.id === nextProps.image.id &&
  prevProps.image.status === nextProps.image.status &&
  prevProps.image.preview === nextProps.image.preview &&
  prevProps.image.originalPreview === nextProps.image.originalPreview &&
  prevProps.image.croppedPreview === nextProps.image.croppedPreview &&
  prevProps.image.confidence === nextProps.image.confidence &&
  prevProps.image.error === nextProps.image.error &&
  prevProps.image.manualRequired === nextProps.image.manualRequired &&
  JSON.stringify(prevProps.image.pageNumbers) === JSON.stringify(nextProps.image.pageNumbers)
));
