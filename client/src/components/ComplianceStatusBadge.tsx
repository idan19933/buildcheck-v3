import type { ComplianceStatus } from '../types';

const cfg: Record<ComplianceStatus, { bg: string; text: string; label: string }> = {
  PASS: { bg: 'bg-emerald-100', text: 'text-emerald-800', label: 'עובר' },
  FAIL: { bg: 'bg-red-100', text: 'text-red-800', label: 'לא עובר' },
  WARNING: { bg: 'bg-amber-100', text: 'text-amber-800', label: 'אזהרה' },
  CANNOT_CHECK: { bg: 'bg-slate-200', text: 'text-slate-700', label: 'לא ניתן לבדוק' },
};

export default function ComplianceStatusBadge({ status }: { status: ComplianceStatus }) {
  const c = cfg[status];
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${c.bg} ${c.text}`}>
      {c.label}
    </span>
  );
}
