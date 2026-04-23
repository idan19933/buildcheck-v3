import type { ComplianceStatus } from '../types';
import { Badge } from './ui';

const cfg: Record<ComplianceStatus, { tone: 'success' | 'danger' | 'warning' | 'neutral'; label: string }> = {
  PASS:         { tone: 'success', label: 'עובר' },
  FAIL:         { tone: 'danger',  label: 'לא עובר' },
  WARNING:      { tone: 'warning', label: 'אזהרה' },
  CANNOT_CHECK: { tone: 'neutral', label: 'לא ניתן לבדוק' },
};

export default function ComplianceStatusBadge({ status }: { status: ComplianceStatus }) {
  const c = cfg[status];
  return <Badge tone={c.tone} dot>{c.label}</Badge>;
}
