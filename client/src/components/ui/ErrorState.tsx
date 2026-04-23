import { AlertCircle, FileSearch, ServerCrash, WifiOff } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from './Button';
import { Card } from './Card';
import { cn } from '../../lib/utils';

type Severity = 'error' | 'not-found' | 'network' | 'server';

interface Props {
  title?: string;
  message?: string;
  onRetry?: () => void;
  retryLabel?: string;
  extra?: ReactNode;
  severity?: Severity;
  technical?: string;   // raw error string — sent to console only
}

/**
 * Translate axios/network noise to friendly Hebrew. Logs the raw text to the
 * console so devs can still debug, but never surfaces "Request failed with
 * status code 404" to end users.
 */
function classify(message: string | undefined, severity?: Severity): {
  severity: Severity;
  title: string;
  message: string;
} {
  const m = (message || '').toLowerCase();
  if (severity === 'not-found' || m.includes('404') || m.includes('not found')) {
    return {
      severity: 'not-found',
      title: 'לא מצאנו את מה שחיפשת',
      message: 'הדף או המשאב הזה לא קיימים, או שאין לך הרשאה לראות אותם.',
    };
  }
  if (severity === 'network' || m.includes('network error') || m.includes('econnrefused') || m.includes('failed to fetch')) {
    return {
      severity: 'network',
      title: 'נראה שהחיבור נפל',
      message: 'בדוק את החיבור לאינטרנט שלך ונסה שוב.',
    };
  }
  if (severity === 'server' || m.includes('500') || m.includes('502') || m.includes('503') || m.includes('504')) {
    return {
      severity: 'server',
      title: 'שגיאת שרת',
      message: 'משהו השתבש בצד שלנו. רעננו את הדף, ואם זה ממשיך — פנו אלינו.',
    };
  }
  return {
    severity: severity ?? 'error',
    title: 'משהו השתבש',
    message: message || 'נסה שוב; אם הבעיה ממשיכה, רענן את הדף.',
  };
}

const ICON: Record<Severity, ReactNode> = {
  error:       <AlertCircle className="h-6 w-6" />,
  'not-found': <FileSearch  className="h-6 w-6" />,
  network:     <WifiOff     className="h-6 w-6" />,
  server:      <ServerCrash className="h-6 w-6" />,
};

const TONE: Record<Severity, { wrap: string; icon: string }> = {
  error:       { wrap: 'border-danger/30 bg-danger-soft',  icon: 'bg-danger-soft text-danger' },
  'not-found': { wrap: 'border-border bg-surface-alt',     icon: 'bg-brand-soft text-brand-dark' },
  network:     { wrap: 'border-warning/30 bg-warning-soft', icon: 'bg-warning-soft text-warning' },
  server:      { wrap: 'border-danger/30 bg-danger-soft',  icon: 'bg-danger-soft text-danger' },
};

export function ErrorState({
  title, message, onRetry, retryLabel = 'נסה שוב', extra, severity, technical,
}: Props) {
  const c = classify(message ?? technical, severity);
  const finalTitle = title ?? c.title;
  const finalMessage = message && severity ? message : c.message;

  // Console-only log for devs.
  if (technical && typeof window !== 'undefined') {
    // eslint-disable-next-line no-console
    console.warn('[ErrorState]', technical);
  }

  return (
    <Card className={cn('border', TONE[c.severity].wrap)}>
      <div className="flex items-start gap-4">
        <div className={cn('h-12 w-12 rounded-md flex items-center justify-center flex-shrink-0', TONE[c.severity].icon)}>
          {ICON[c.severity]}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-text">{finalTitle}</p>
          {finalMessage && <p className="text-sm text-text-soft mt-1 leading-relaxed">{finalMessage}</p>}
          {extra && <div className="mt-3">{extra}</div>}
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
