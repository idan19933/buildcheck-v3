import { AlertCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from './Button';
import { Card } from './Card';

interface Props {
  title?: string;
  message?: string;
  onRetry?: () => void;
  retryLabel?: string;
  extra?: ReactNode;
}

export function ErrorState({
  title = 'שגיאה בטעינת הנתונים',
  message,
  onRetry,
  retryLabel = 'נסה שוב',
  extra,
}: Props) {
  return (
    <Card className="border-danger/30 bg-danger-soft">
      <div className="flex items-start gap-3">
        <AlertCircle className="h-5 w-5 text-danger mt-0.5 flex-shrink-0" />
        <div className="flex-1">
          <p className="font-medium text-danger">{title}</p>
          {message && <p className="text-sm text-text-soft mt-1">{message}</p>}
          {extra}
        </div>
        {onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry}>
            {retryLabel}
          </Button>
        )}
      </div>
    </Card>
  );
}
