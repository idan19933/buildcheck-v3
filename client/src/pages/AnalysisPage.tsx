import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowRight, CheckCircle2, XCircle, AlertTriangle, HelpCircle, Loader2,
  Download, FileText, X,
} from 'lucide-react';
import api from '../services/api';
import ComplianceReport from '../components/ComplianceReport';
import AddonAgentCard from '../components/AddonAgentCard';
import DxfPreview from '../components/DxfPreview';
import { AnimatedNumber, Badge, Button, Card, ErrorState, ScoreRing, SkeletonCard, StackedBar } from '../components/ui';
import { cn, timeAgoHe } from '../lib/utils';
import type { Analysis, AddonInfo } from '../types';

const STATUS_LABELS: Record<string, string> = {
  PENDING:        'ממתין…',
  EXTRACTING_DXF: 'מחלץ נתונים מה-DXF…',
  EXTRACTING_TAVA:'מחלץ דרישות מהתב"ע…',
  ANALYZING:      'בודק תאימות…',
  COMPLETED:      'הושלם',
  FAILED:         'נכשל',
};

const STATUS_TONES: Record<string, 'neutral' | 'brand' | 'success' | 'danger'> = {
  PENDING:         'neutral',
  EXTRACTING_DXF:  'brand',
  EXTRACTING_TAVA: 'brand',
  ANALYZING:       'brand',
  COMPLETED:       'success',
  FAILED:          'danger',
};

export default function AnalysisPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [addons, setAddons] = useState<AddonInfo[]>([]);
  const [viewAddon, setViewAddon] = useState<AddonInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const polling = useRef(true);

  const loadAll = async () => {
    try {
      const { data } = await api.get<{ analysis: Analysis }>(`/analyses/${id}`);
      setAnalysis(data.analysis);
      if (data.analysis.status === 'COMPLETED' || data.analysis.status === 'FAILED') {
        polling.current = false;
        const addonRes = await api.get<{ addons: AddonInfo[] }>(`/analyses/${id}/addons`);
        setAddons(addonRes.data.addons);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'נכשל לטעון בדיקה');
    }
  };

  useEffect(() => {
    loadAll();
    const t = setInterval(() => { if (polling.current) loadAll(); }, 2500);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (error) return <div><BackLink /><ErrorState technical={error} onRetry={loadAll} /></div>;
  if (!analysis) {
    return <div className="space-y-5"><SkeletonCard /><SkeletonCard /></div>;
  }

  const inProgress = ['PENDING', 'EXTRACTING_DXF', 'EXTRACTING_TAVA', 'ANALYZING'].includes(analysis.status);
  const done = analysis.status === 'COMPLETED';
  const failed = analysis.status === 'FAILED';

  return (
    <div>
      <BackLink />

      {/* Hero */}
      <Card padded={false} className="mb-6 overflow-hidden">
        <div className="bg-gradient-to-l from-brand-soft/60 via-brand-soft/30 to-surface px-6 py-8 sm:py-10">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0">
              {analysis.project?.name && (
                <div className="text-sm text-text-soft mb-1">
                  <Link to={`/projects/${analysis.projectId}`} className="hover:text-brand transition-colors duration-fast">
                    {analysis.project.name}
                  </Link>
                </div>
              )}
              <h1 className="text-2xl sm:text-3xl font-semibold text-text">בדיקת תאימות</h1>
              <div className="flex items-center gap-3 mt-3">
                <Badge tone={STATUS_TONES[analysis.status]} dot>
                  {STATUS_LABELS[analysis.status] || analysis.status}
                </Badge>
                {analysis.completedAt && (
                  <span className="text-xs text-text-muted">{timeAgoHe(analysis.completedAt)}</span>
                )}
                <span className="text-xs text-text-muted font-latin tracking-wider" dir="ltr">
                  #{analysis.id.slice(0, 8)}
                </span>
              </div>
            </div>

            {done && (
              <Button variant="outline" icon={<Download className="h-4 w-4" />} disabled>
                ייצוא דוח
              </Button>
            )}
          </div>
        </div>
      </Card>

      {inProgress && (
        <Card className="mb-6 border-brand/30 bg-brand-soft/30">
          <div className="flex items-center gap-3">
            <Loader2 className="h-5 w-5 animate-spin text-brand" />
            <div className="text-sm text-text">{STATUS_LABELS[analysis.status]}</div>
          </div>
        </Card>
      )}

      {failed && (
        <div className="mb-6">
          <ErrorState
            severity="server"
            title="הבדיקה לא הסתיימה בהצלחה"
            message="משהו השתבש בזמן הריצה. אפשר לנסות להפעיל את הבדיקה מחדש מתוך עמוד הפרויקט."
            technical={analysis.errorMessage ?? undefined}
            extra={
              <Link to={`/projects/${analysis.projectId}`} className="text-sm text-brand hover:text-brand-dark font-medium">
                ← חזרה לעמוד הפרויקט
              </Link>
            }
          />
        </div>
      )}

      {/* Sheet browser — shows previews early, swaps to AI sheets when ready */}
      {analysis.project?.dxfFile?.renderedImages ? (
        <div className="mb-8">
          <DxfPreview
            dxfFileId={analysis.project.dxfFile.id}
            rendered={analysis.project.dxfFile.renderedImages}
          />
        </div>
      ) : null}

      {done && (
        <>
          {/* Hero scoreboard — donut ring + 4 stat tiles + 4-segment proportional bar */}
          <Card className="mb-8 overflow-hidden">
            <div className="grid grid-cols-1 lg:grid-cols-[auto_1fr] gap-8 items-center">
              <ScoreRing score={analysis.overallScore} />
              <div className="space-y-5 min-w-0">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <StatTile label="עובר"     value={analysis.passCount ?? 0}        tone="success" icon={<CheckCircle2 className="h-4 w-4" />} />
                  <StatTile label="לא עובר"   value={analysis.failCount ?? 0}        tone="danger"  icon={<XCircle className="h-4 w-4" />} />
                  <StatTile label="אזהרה"    value={analysis.warningCount ?? 0}     tone="warning" icon={<AlertTriangle className="h-4 w-4" />} />
                  <StatTile label="לא נבדק"  value={analysis.cannotCheckCount ?? 0} tone="neutral" icon={<HelpCircle className="h-4 w-4" />} />
                </div>
                <StackedBar
                  segments={[
                    { value: analysis.passCount ?? 0,        color: 'var(--color-success)', label: 'עובר' },
                    { value: analysis.failCount ?? 0,        color: 'var(--color-danger)',  label: 'לא עובר' },
                    { value: analysis.warningCount ?? 0,     color: 'var(--color-warning)', label: 'אזהרה' },
                    { value: analysis.cannotCheckCount ?? 0, color: 'var(--color-border-strong)', label: 'לא נבדק' },
                  ]}
                />
                {analysis.summary && (
                  <p className="text-sm text-text-soft leading-relaxed">{analysis.summary}</p>
                )}
              </div>
            </div>
          </Card>

          {/* Compliance results with filter chips */}
          <SectionHeader title='דרישות התב"ע' subtitle="Core Compliance" />
          <ComplianceReport results={analysis.coreResults || []} />

          {/* Add-on agents */}
          {addons.length > 0 && (
            <>
              <div className="mt-12">
                <SectionHeader title="בדיקות נוספות" subtitle="Optional Checks" />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {addons.map((info) => (
                  <AddonAgentCard
                    key={info.domain}
                    info={info}
                    projectId={analysis.projectId}
                    analysisId={analysis.id}
                    onChange={loadAll}
                    onView={() => setViewAddon(info)}
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}

      {/* Addon detail modal */}
      {viewAddon && viewAddon.run?.results && (
        <AddonModal addon={viewAddon} onClose={() => setViewAddon(null)} />
      )}
    </div>
  );
}

function StatTile({
  label, value, tone, icon,
}: { label: string; value: number; tone: 'success' | 'danger' | 'warning' | 'neutral'; icon: React.ReactNode }) {
  const cls = {
    success: 'bg-success-soft text-success',
    danger:  'bg-danger-soft text-danger',
    warning: 'bg-warning-soft text-warning',
    neutral: 'bg-surface-muted text-text-muted',
  }[tone];
  return (
    <div className="bg-surface-alt border border-border rounded-md px-4 py-3">
      <div className="flex items-center gap-2 text-xs text-text-soft mb-1.5">
        <span className={cn('h-5 w-5 rounded inline-flex items-center justify-center', cls)}>{icon}</span>
        {label}
      </div>
      <div className="text-2xl font-semibold tabular-nums font-latin text-text leading-none">
        <AnimatedNumber value={value} />
      </div>
    </div>
  );
}

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-5 pb-3 border-b border-border">
      {subtitle && (
        <div className="text-[11px] uppercase tracking-[0.18em] text-text-muted font-latin" dir="ltr">
          {subtitle}
        </div>
      )}
      <h2 className="text-xl font-semibold text-text mt-1">{title}</h2>
    </div>
  );
}

function AddonModal({ addon, onClose }: { addon: AddonInfo; onClose: () => void }) {
  // Trap focus + close on ESC
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 backdrop-blur-sm z-50 flex items-center justify-center p-4 sm:p-8"
      style={{ background: 'var(--color-modal-scrim)' }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-surface rounded-lg shadow-xl w-full max-w-3xl max-h-[88vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border">
          <h3 className="text-lg font-semibold text-text">{addon.displayName}</h3>
          <button onClick={onClose} aria-label="סגור"
            className="p-1.5 rounded-md text-text-muted hover:text-text hover:bg-surface-muted transition-colors duration-fast">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="overflow-auto p-5 flex-1">
          {addon.run?.summary && (
            <div className="text-sm text-text-soft mb-5 leading-relaxed">{addon.run.summary}</div>
          )}
          <ComplianceReport results={addon.run?.results || []} />
        </div>
      </div>
    </div>
  );
}

function BackLink() {
  return (
    <button
      onClick={() => window.history.back()}
      className="inline-flex items-center gap-1.5 text-sm text-text-soft hover:text-brand transition-colors duration-fast mb-5"
    >
      <ArrowRight className="h-4 w-4" />
      חזרה
    </button>
  );
}

void FileText;
