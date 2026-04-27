import { ArrowLeft, X } from 'lucide-react';
import { Button } from '../ui/Button';

interface Props {
  count: number;
  onContinue: () => void;
  onClear: () => void;
}

/**
 * Sticky bottom action bar. Slides up from below when ≥1 agent selected,
 * disappears when none. Centered with comfortable hit targets.
 */
export function AgentSelectionBar({ count, onContinue, onClear }: Props) {
  if (count === 0) return null;

  return (
    <div className="fixed bottom-0 inset-x-0 z-30 pointer-events-none animate-slide-up">
      <div className="mx-auto max-w-3xl m-4 pointer-events-auto">
        <div
          className="flex items-center justify-between gap-4 rounded-xl border border-border-strong
                     bg-surface px-5 py-3 shadow-lg"
        >
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClear}
              aria-label="נקה בחירה"
              className="h-8 w-8 inline-flex items-center justify-center rounded-md
                         text-text-soft hover:bg-surface-muted transition-colors duration-fast"
            >
              <X className="h-4 w-4" />
            </button>
            <div>
              <div className="text-sm text-text-soft">סוכנים שנבחרו</div>
              <div className="text-base font-semibold text-text">
                {count === 1 ? 'סוכן אחד' : `${count} סוכנים`}
              </div>
            </div>
          </div>

          <Button onClick={onContinue} icon={<ArrowLeft className="h-4 w-4" />} iconPosition="end">
            המשך לניתוח
          </Button>
        </div>
      </div>
    </div>
  );
}
