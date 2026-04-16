import type { ComplianceResult } from '../types';
import ComplianceStatusBadge from './ComplianceStatusBadge';

export default function ComplianceReport({ results }: { results: ComplianceResult[] }) {
  if (!results?.length) {
    return <div className="text-slate-500">אין תוצאות להצגה.</div>;
  }
  return (
    <div className="space-y-3">
      {results.map((r, i) => (
        <div key={i} className="bg-white rounded-lg border border-slate-200 p-4">
          <div className="flex items-start justify-between gap-3 mb-2">
            <div className="flex-1">
              <div className="font-semibold">{r.requirement}</div>
              <div className="text-xs text-slate-500 mt-0.5">{r.source}</div>
            </div>
            <ComplianceStatusBadge status={r.status} />
          </div>
          <div className="text-sm text-slate-700 leading-relaxed">{r.details}</div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
            {r.measuredValue != null && (
              <div className="bg-slate-50 rounded p-2">
                <span className="text-slate-500">נמדד: </span>
                <span className="font-medium">{String(r.measuredValue)}</span>
              </div>
            )}
            {r.requiredValue != null && (
              <div className="bg-slate-50 rounded p-2">
                <span className="text-slate-500">נדרש: </span>
                <span className="font-medium">{String(r.requiredValue)}</span>
              </div>
            )}
          </div>
          {r.dxfEvidence && (
            <div className="mt-2 text-xs text-slate-500">
              <span className="font-medium">מקור ב-DXF: </span>{r.dxfEvidence}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
