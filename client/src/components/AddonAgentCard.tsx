import { useRef, useState } from 'react';
import {
  Play, Upload, CheckCircle2, XCircle, AlertTriangle, HelpCircle,
  Flame, Droplets, Zap, Accessibility,
} from 'lucide-react';
import { toast } from 'sonner';
import api from '../services/api';
import type { AddonInfo, AddonDomain } from '../types';
import { Badge, Button } from './ui';
import { cn, scoreTone } from '../lib/utils';

const ICON_TINTS: Record<AddonDomain, { icon: React.ReactNode; bg: string; text: string }> = {
  FIRE: {
    icon: <Flame className="h-5 w-5" />,
    bg: 'bg-danger-soft', text: 'text-danger',
  },
  WATER: {
    icon: <Droplets className="h-5 w-5" />,
    bg: 'bg-brand-soft', text: 'text-info',
  },
  ELECTRICITY: {
    icon: <Zap className="h-5 w-5" />,
    bg: 'bg-warning-soft', text: 'text-warning',
  },
  ACCESSIBILITY: {
    icon: <Accessibility className="h-5 w-5" />,
    bg: 'bg-success-soft', text: 'text-success',
  },
};

interface Props {
  info: AddonInfo;
  projectId: string;
  analysisId: string;
  onChange: () => void;
  onView: () => void;
}

export default function AddonAgentCard({ info, projectId, analysisId, onChange, onView }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const uploadDoc = async (file: File) => {
    setBusy(true);
    const tid = toast.loading('מעלה מסמך…');
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('domain', info.domain);
      await api.post(`/projects/${projectId}/addon-docs`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      toast.success('המסמך הועלה', { id: tid });
      onChange();
    } catch (e) {
      const ax = e as { response?: { data?: { error?: string } } };
      toast.error(ax.response?.data?.error || 'העלאת המסמך נכשלה', { id: tid });
    } finally { setBusy(false); }
  };

  const runAgent = async () => {
    setBusy(true);
    const tid = toast.loading(`מפעיל ${info.displayName}…`);
    try {
      await api.post(`/analyses/${analysisId}/addons/${info.domain}/run`);
      toast.success(`${info.displayName} פועל`, { id: tid });
      onChange();
    } catch (e) {
      const ax = e as { response?: { data?: { error?: string } } };
      toast.error(ax.response?.data?.error || 'הפעלה נכשלה', { id: tid });
    } finally { setBusy(false); }
  };

  const run = info.run;
  const runStatus = run?.status;
  const tint = ICON_TINTS[info.domain];

  return (
    <div className="bg-surface rounded-lg border border-border p-5 shadow-xs flex flex-col">
      <div className="flex items-start gap-3 mb-4">
        <div className={cn('h-10 w-10 rounded-md flex items-center justify-center flex-shrink-0', tint.bg, tint.text)}>
          {tint.icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-text">{info.displayName}</div>
          {info.documentName && (
            <div className="text-xs text-text-muted truncate mt-0.5" title={info.documentName}>
              {info.documentName}
            </div>
          )}
        </div>
        {runStatus === 'RUNNING' && <Badge tone="brand" dot>פועל</Badge>}
        {runStatus === 'COMPLETED' && <Badge tone="success" dot>הושלם</Badge>}
        {runStatus === 'FAILED' && <Badge tone="danger" dot>נכשל</Badge>}
      </div>

      {!info.hasDocument && (
        <>
          <p className="text-sm text-text-soft mb-4 flex-1">העלה מסמך תקנות/דרישות כדי להפעיל את הבודק.</p>
          <Button
            onClick={() => inputRef.current?.click()}
            loading={busy}
            variant="outline"
            size="sm"
            icon={<Upload className="h-4 w-4" />}
            className="w-full"
          >
            העלה מסמך
          </Button>
        </>
      )}

      {info.hasDocument && !run && (
        <>
          <p className="text-sm text-text-soft mb-4 flex-1">המסמך הועלה. ניתן להפעיל את הבודק.</p>
          <Button
            onClick={runAgent}
            loading={busy}
            icon={<Play className="h-4 w-4" />}
            className="w-full"
          >
            הפעל בדיקה
          </Button>
        </>
      )}

      {run && runStatus === 'RUNNING' && (
        <div className="flex-1 flex items-center justify-center text-sm text-text-soft py-4">
          מנתח את המסמך…
        </div>
      )}

      {run && runStatus === 'COMPLETED' && (
        <>
          <div className="flex items-baseline gap-2 mb-3">
            <span className={cn(
              'text-3xl font-semibold tabular-nums font-latin',
              scoreTone(run.score) === 'success' && 'text-success',
              scoreTone(run.score) === 'warning' && 'text-warning',
              scoreTone(run.score) === 'danger' && 'text-danger',
              scoreTone(run.score) === 'neutral' && 'text-text-muted',
            )} dir="ltr">
              {run.score ?? 0}
            </span>
            <span className="text-xs text-text-muted">ציון</span>
          </div>
          <div className="grid grid-cols-4 gap-1.5 text-[11px] mb-3">
            <CountChip icon={<CheckCircle2 className="h-3 w-3" />} count={run.passCount ?? 0} tone="success" />
            <CountChip icon={<XCircle className="h-3 w-3" />} count={run.failCount ?? 0} tone="danger" />
            <CountChip icon={<AlertTriangle className="h-3 w-3" />} count={run.warningCount ?? 0} tone="warning" />
            <CountChip icon={<HelpCircle className="h-3 w-3" />} count={run.cannotCheckCount ?? 0} tone="neutral" />
          </div>
          <div className="flex gap-2 mt-auto">
            <Button onClick={onView} variant="secondary" size="sm" className="flex-1">
              הצג פירוט
            </Button>
            <Button onClick={runAgent} loading={busy} variant="ghost" size="sm" aria-label="הפעל שוב">
              <Play className="h-3.5 w-3.5" />
            </Button>
          </div>
        </>
      )}

      {run && runStatus === 'FAILED' && (
        <div className="text-sm text-danger mt-2">{run.errorMessage}</div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.doc,.docx,.txt"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) uploadDoc(f);
        }}
      />
    </div>
  );
}

function CountChip({ icon, count, tone }: { icon: React.ReactNode; count: number; tone: 'success' | 'danger' | 'warning' | 'neutral' }) {
  const cls = {
    success: 'bg-success-soft text-success',
    danger:  'bg-danger-soft text-danger',
    warning: 'bg-warning-soft text-warning',
    neutral: 'bg-surface-muted text-text-muted',
  }[tone];
  return (
    <div className={cn('flex items-center justify-center gap-1 py-1 rounded-md font-latin tabular-nums', cls)} dir="ltr">
      {icon}
      {count}
    </div>
  );
}
