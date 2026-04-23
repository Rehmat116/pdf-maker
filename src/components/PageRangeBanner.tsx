import { AlertTriangle, CheckCircle, BookOpen, Upload } from 'lucide-react';
import { PageRange } from '@/types/book';
import { Button } from '@/components/ui/button';

interface PageRangeBannerProps {
  range: PageRange | null;
  onUploadMissing?: () => void;
}

export function PageRangeBanner({ range, onUploadMissing }: PageRangeBannerProps) {
  if (!range) return null;

  const hasMissingPages = range.missing.length > 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 rounded-[20px] border border-border bg-card p-4 shadow-sm">
        <div className={`rounded-2xl p-2 ${hasMissingPages ? 'bg-amber-500/10' : 'bg-[hsl(var(--accent))]/10'}`}>
          <BookOpen className={`h-5 w-5 ${hasMissingPages ? 'text-amber-500' : 'text-[hsl(var(--accent))]'}`} />
        </div>

        <div className="flex-1">
          <h3 className="text-sm font-medium text-foreground">
            Pages {range.min} - {range.max}
          </h3>
          <p className="text-xs text-muted-foreground">
            {range.max - range.min + 1 - range.missing.length} of {range.max - range.min + 1} found
          </p>
        </div>

        <div
          className={`
            rounded-full px-2.5 py-1 text-xs font-medium
            ${hasMissingPages ? 'bg-amber-500/10 text-amber-500' : 'bg-[hsl(var(--accent))]/10 text-[hsl(var(--accent))]'}
          `}
        >
          {hasMissingPages ? (
            <span className="flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" />
              {range.missing.length} Missing
            </span>
          ) : (
            <span className="flex items-center gap-1">
              <CheckCircle className="h-3 w-3" />
              Complete
            </span>
          )}
        </div>
      </div>

      {hasMissingPages && (
        <div className="rounded-[20px] border border-red-200 bg-red-50/70 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 text-red-500" />
            <div className="flex-1">
              <h4 className="mb-1 text-sm font-medium text-red-500">
                Missing Pages
              </h4>
              <div className="mb-3 flex flex-wrap gap-1.5">
                {range.missing.slice(0, 15).map((page) => (
                  <span
                    key={page}
                    className="rounded bg-red-500/10 px-1.5 py-0.5 font-mono text-xs text-red-500"
                  >
                    {page}
                  </span>
                ))}
                {range.missing.length > 15 && (
                  <span className="rounded bg-secondary px-1.5 py-0.5 text-xs text-muted-foreground">
                    +{range.missing.length - 15} more
                  </span>
                )}
              </div>
              {onUploadMissing && (
                <Button onClick={onUploadMissing} size="sm" variant="outline" className="h-8 gap-1.5 rounded-full text-xs">
                  <Upload className="h-3 w-3" />
                  Upload Missing
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
