import { ProcessingState } from '@/types/book';

interface ProgressBarProps {
  state: ProcessingState;
  isProcessing: boolean;
}

export function ProgressBar({ state, isProcessing }: ProgressBarProps) {
  const { total, completed, errors } = state;
  const progress = total > 0 ? ((completed + errors) / total) * 100 : 0;

  if (!isProcessing && total === 0) return null;

  return (
    <div className="space-y-2 rounded-[20px] border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-foreground">
          {isProcessing ? 'Processing...' : 'Complete'}
        </span>
        <span className="text-muted-foreground">
          {completed + errors} / {total}
        </span>
      </div>

      <div className="relative h-2 overflow-hidden rounded-full bg-secondary">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-[linear-gradient(90deg,#e8b84b,#c9a84c)] transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="flex items-center gap-4 text-xs">
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          <span className="text-muted-foreground">{completed} done</span>
        </span>
        {errors > 0 && (
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
            <span className="text-muted-foreground">{errors} errors</span>
          </span>
        )}
      </div>
    </div>
  );
}
