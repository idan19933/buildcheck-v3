import { useMemo, useState } from 'react';
import { Inbox } from 'lucide-react';
import type { ComplianceResult, ComplianceStatus } from '../types';
import ComplianceStatusBadge from './ComplianceStatusBadge';
import { Card, EmptyState } from './ui';
import { cn } from '../lib/utils';

type Filter = 'ALL' | ComplianceStatus;

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'ALL',          label: 'הכול' },
  { value: 'PASS',         label: 'עובר' },
  { value: 'FAIL',         label: 'לא עובר' },
  { value: 'WARNING',      label: 'אזהרה' },
  { value: 'CANNOT_CHECK', label: 'לא ניתן לבדוק' },
];

const TONE_BORDER: Record<ComplianceStatus, string> = {
  PASS:         'border-s-success',
  FAIL:         'border-s-danger',
  WARNING:      'border-s-warning',
  CANNOT_CHECK: 'border-s-border-strong',
};

export default function ComplianceReport({ results }: { results: ComplianceResult[] }) {
  const [filter, setFilter] = useState<Filter>('ALL');

  const counts = useMemo(() => {
    const c: Record<ComplianceStatus, number> = { PASS: 0, FAIL: 0, WARNING: 0, CANNOT_CHECK: 0 };
    for (const r of results) c[r.status] = (c[r.status] || 0) + 1;
    return c;
  }, [results]);

  const filtered = useMemo(() => {
    if (filter === 'ALL') return results;
    return results.filter((r) => r.status === filter);
  }, [results, filter]);

  if (!results?.length) {
    return <EmptyState icon={<Inbox className="h-8 w-8" />} title="אין תוצאות להצגה" />;
  }

  return (
    <div>
      {/* Filter chips */}
      <div className="flex flex-wrap gap-2 mb-5">
        {FILTERS.map((f) => {
          const count = f.value === 'ALL' ? results.length : counts[f.value];
          if (f.value !== 'ALL' && count === 0) return null;
          const active = filter === f.value;
          return (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={cn(
                'inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded-full border transition-colors duration-fast',
                active
                  ? 'bg-brand text-white border-brand'
                  : 'bg-surface text-text-soft border-border hover:bg-surface-muted hover:text-text',
              )}
            >
              <span className="font-medium">{f.label}</span>
              <span className={cn(
                'text-xs tabular-nums font-latin px-1.5 py-0.5 rounded-full',
                active ? 'bg-white/20' : 'bg-surface-muted',
              )} dir="ltr">
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Results */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={<Inbox className="h-8 w-8" />}
          title={`אין תוצאות בקטגוריה "${FILTERS.find(f => f.value === filter)?.label}"`}
        />
      ) : (
        <div className="space-y-3">
          {filtered.map((r, i) => <ResultCard key={i} r={r} />)}
        </div>
      )}
    </div>
  );
}

function ResultCard({ r }: { r: ComplianceResult }) {
  return (
    <Card className={cn('border-s-4', TONE_BORDER[r.status])}>
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-text">{r.requirement}</div>
          <div className="text-xs text-text-muted mt-0.5">{r.source}</div>
        </div>
        <ComplianceStatusBadge status={r.status} />
      </div>
      {r.details && (
        <div className="text-sm text-text-soft leading-relaxed">{r.details}</div>
      )}
      {(r.measuredValue != null || r.requiredValue != null) && (
        <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
          {r.measuredValue != null && (
            <ValueChip term="נמדד" value={r.measuredValue} />
          )}
          {r.requiredValue != null && (
            <ValueChip term="נדרש" value={r.requiredValue} />
          )}
        </div>
      )}
      {r.dxfEvidence && (
        <div className="mt-3 text-xs text-text-muted">
          <span className="font-medium text-text-soft">מקור ב-DXF: </span>{r.dxfEvidence}
        </div>
      )}
    </Card>
  );
}

function ValueChip({ term, value }: { term: string; value: string | number }) {
  const isNum = typeof value === 'number';
  return (
    <div className="bg-surface-muted rounded-md px-3 py-2">
      <div className="text-xs text-text-muted mb-0.5">{term}</div>
      <div className={cn('font-medium text-text', isNum && 'font-latin tabular-nums')} dir={isNum ? 'ltr' : undefined}>
        {String(value)}
      </div>
    </div>
  );
}
