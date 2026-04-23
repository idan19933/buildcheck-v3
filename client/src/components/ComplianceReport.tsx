import { useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { ChevronDown, ChevronUp, Inbox, Search } from 'lucide-react';
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

const TONE_BG: Record<ComplianceStatus, string> = {
  PASS:         'hover:bg-success-soft/30',
  FAIL:         'hover:bg-danger-soft/30',
  WARNING:      'hover:bg-warning-soft/30',
  CANNOT_CHECK: 'hover:bg-surface-muted',
};

/**
 * Best-effort chapter extraction. Hebrew sources from the curated docs read like
 * "§פרק ד' §1.1" or "תקנון 506/1, §2.2.א". We split off the leading "פרק ..."
 * portion so we can group rows. Falls back to the whole source string.
 */
function chapterOf(source: string): string {
  if (!source) return 'אחר';
  const m = source.match(/פרק\s+[א-ת]+'?/);
  if (m) return m[0];
  // Fall back to first " §..." segment
  const seg = source.split(',')[0].trim();
  return seg || 'אחר';
}

export default function ComplianceReport({ results }: { results: ComplianceResult[] }) {
  const [filter, setFilter] = useState<Filter>('ALL');
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const counts = useMemo(() => {
    const c: Record<ComplianceStatus, number> = { PASS: 0, FAIL: 0, WARNING: 0, CANNOT_CHECK: 0 };
    for (const r of results) c[r.status] = (c[r.status] || 0) + 1;
    return c;
  }, [results]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return results.filter((r) => {
      if (filter !== 'ALL' && r.status !== filter) return false;
      if (!q) return true;
      return (
        r.requirement.toLowerCase().includes(q) ||
        r.source.toLowerCase().includes(q) ||
        (r.details || '').toLowerCase().includes(q) ||
        (r.category || '').toLowerCase().includes(q)
      );
    });
  }, [results, filter, query]);

  const grouped = useMemo(() => {
    const map = new Map<string, ComplianceResult[]>();
    for (const r of filtered) {
      const ch = chapterOf(r.source);
      const list = map.get(ch) || [];
      list.push(r);
      map.set(ch, list);
    }
    return Array.from(map.entries());
  }, [filtered]);

  if (!results?.length) {
    return <EmptyState icon={<Inbox className="h-8 w-8" />} title="אין תוצאות להצגה" />;
  }

  return (
    <div>
      {/* Filter row */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex flex-wrap gap-2">
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
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute end-3 top-1/2 -translate-y-1/2 text-text-muted h-4 w-4 pointer-events-none" />
          <input
            type="text"
            placeholder="חיפוש דרישה / סעיף..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full h-9 pe-9 ps-3 rounded-md border border-border bg-surface text-sm text-text placeholder:text-text-muted focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
          />
        </div>
      </div>

      {/* Empty state */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={<Inbox className="h-8 w-8" />}
          title="אין תוצאות תואמות"
          description={query ? `אין תוצאה התואמת לחיפוש "${query}".` : undefined}
        />
      ) : (
        <Card padded={false} className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-muted text-xs text-text-soft border-b border-border">
                <tr>
                  <th className="p-3 text-start font-medium w-8" aria-label="פתח" />
                  <th className="p-3 text-start font-medium">דרישה</th>
                  <th className="p-3 text-start font-medium hidden md:table-cell">מצב</th>
                  <th className="p-3 text-start font-medium hidden lg:table-cell">נמדד</th>
                  <th className="p-3 text-start font-medium hidden lg:table-cell">נדרש</th>
                </tr>
              </thead>
              <tbody>
                {grouped.map(([chapter, rows]) => (
                  <ChapterGroup
                    key={chapter}
                    chapter={chapter}
                    rows={rows}
                    allResults={results}
                    expanded={expanded}
                    setExpanded={setExpanded}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function ChapterGroup({
  chapter, rows, allResults, expanded, setExpanded,
}: {
  chapter: string;
  rows: ComplianceResult[];
  allResults: ComplianceResult[];
  expanded: Set<number>;
  setExpanded: Dispatch<SetStateAction<Set<number>>>;
}) {
  return (
    <>
      <tr className="bg-surface-alt/60">
        <td colSpan={5} className="px-3 py-2 text-xs font-semibold text-text-soft uppercase tracking-wider">
          {chapter}
          <span className="text-text-muted font-normal me-2 font-latin tabular-nums" dir="ltr"> · {rows.length}</span>
        </td>
      </tr>
      {rows.map((r) => {
        const idx = allResults.indexOf(r);
        const open = expanded.has(idx);
        return (
          <RuleRow
            key={idx}
            r={r}
            open={open}
            onToggle={() => {
              setExpanded((prev) => {
                const next = new Set(prev);
                if (next.has(idx)) next.delete(idx); else next.add(idx);
                return next;
              });
            }}
          />
        );
      })}
    </>
  );
}

function RuleRow({ r, open, onToggle }: { r: ComplianceResult; open: boolean; onToggle: () => void }) {
  return (
    <>
      <tr
        className={cn(
          'border-t border-border cursor-pointer transition-colors duration-fast border-s-4',
          TONE_BORDER[r.status], TONE_BG[r.status],
        )}
        onClick={onToggle}
      >
        <td className="p-3 align-top w-8">
          <button
            type="button"
            aria-expanded={open}
            aria-label={open ? 'סגור פרטים' : 'הצג פרטים'}
            className="p-1 rounded text-text-muted hover:text-text"
            onClick={(e) => { e.stopPropagation(); onToggle(); }}
          >
            {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </td>
        <td className="p-3 align-top">
          <div className="font-medium text-text">{r.requirement}</div>
          <div className="text-xs text-text-muted mt-0.5 font-latin" dir="ltr">{r.source}</div>
          {/* Status badge inline on small screens; in its own column on md+ */}
          <div className="md:hidden mt-2"><ComplianceStatusBadge status={r.status} /></div>
        </td>
        <td className="p-3 align-top hidden md:table-cell">
          <ComplianceStatusBadge status={r.status} />
        </td>
        <td className="p-3 align-top hidden lg:table-cell">
          <Value v={r.measuredValue} dim />
        </td>
        <td className="p-3 align-top hidden lg:table-cell">
          <Value v={r.requiredValue} />
        </td>
      </tr>
      {open && (
        <tr className="border-t border-border bg-surface-alt/40">
          <td colSpan={5} className="p-4">
            {r.details && (
              <p className="text-sm text-text leading-relaxed mb-3">{r.details}</p>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm mb-3 lg:hidden">
              {r.measuredValue != null && (
                <ValuePair term="נמדד" value={r.measuredValue} />
              )}
              {r.requiredValue != null && (
                <ValuePair term="נדרש" value={r.requiredValue} />
              )}
            </div>
            {r.dxfEvidence && (
              <div className="text-xs text-text-muted">
                <span className="font-medium text-text-soft">מקור ב-DXF: </span>{r.dxfEvidence}
              </div>
            )}
            {r.category && (
              <div className="text-xs text-text-muted mt-1">
                <span className="font-medium text-text-soft">קטגוריה: </span>
                <span className="font-latin" dir="ltr">{r.category}</span>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function Value({ v, dim }: { v: string | number | null; dim?: boolean }) {
  if (v == null) return <span className="text-text-muted">—</span>;
  const isNum = typeof v === 'number';
  return (
    <span
      className={cn('font-medium', dim ? 'text-text-soft' : 'text-text', isNum && 'font-latin tabular-nums')}
      dir={isNum ? 'ltr' : undefined}
    >
      {String(v)}
    </span>
  );
}

function ValuePair({ term, value }: { term: string; value: string | number }) {
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
