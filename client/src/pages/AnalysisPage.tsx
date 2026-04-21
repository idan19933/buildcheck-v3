import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, XCircle, AlertTriangle, HelpCircle, Loader2 } from 'lucide-react';
import api from '../services/api';
import ComplianceReport from '../components/ComplianceReport';
import AddonAgentCard from '../components/AddonAgentCard';
import DxfPreview from '../components/DxfPreview';
import type { Analysis, AddonInfo } from '../types';

const STATUS_LABELS: Record<string, string> = {
  PENDING: 'ממתין…',
  EXTRACTING_DXF: 'מחלץ נתונים מה-DXF…',
  EXTRACTING_TAVA: 'מחלץ דרישות מהתב"ע…',
  ANALYZING: 'בודק תאימות…',
  COMPLETED: 'הושלם',
  FAILED: 'נכשל',
};

export default function AnalysisPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [addons, setAddons] = useState<AddonInfo[]>([]);
  const [viewAddon, setViewAddon] = useState<AddonInfo | null>(null);
  const polling = useRef(true);

  const loadAll = async () => {
    const { data } = await api.get<{ analysis: Analysis }>(`/analyses/${id}`);
    setAnalysis(data.analysis);
    if (data.analysis.status === 'COMPLETED' || data.analysis.status === 'FAILED') {
      polling.current = false;
      const addonRes = await api.get<{ addons: AddonInfo[] }>(`/analyses/${id}/addons`);
      setAddons(addonRes.data.addons);
    }
  };

  useEffect(() => {
    loadAll();
    const t = setInterval(() => { if (polling.current) loadAll(); }, 2500);
    return () => clearInterval(t);
  }, [id]);

  if (!analysis) return <div className="text-slate-500">טוען…</div>;

  const inProgress = ['PENDING', 'EXTRACTING_DXF', 'EXTRACTING_TAVA', 'ANALYZING'].includes(analysis.status);
  const done = analysis.status === 'COMPLETED';

  return (
    <div>
      <button onClick={() => nav(-1)} className="text-ink-50 hover:text-terra-600 text-xs mb-5 flex items-center gap-1.5 font-mono tracking-wider transition-colors">
        <ArrowLeft className="w-3.5 h-3.5" /> חזרה
      </button>
      <div className="mb-6 pb-4 border-b border-ink-300/15">
        <div className="font-mono text-[10px] tracking-[0.22em] text-ink-50 uppercase mb-1">
          Compliance Audit · {analysis.id.slice(0, 8)}
        </div>
        <h1 className="font-serif text-3xl text-ink-300 leading-tight">בדיקת תאימות</h1>
        <div className="text-ink-50 text-sm mt-1">{STATUS_LABELS[analysis.status] || analysis.status}</div>
      </div>

      {inProgress && (
        <div className="bg-paper-100 border border-terra-500/25 px-5 py-4 flex items-center gap-3 mb-6">
          <Loader2 className="w-5 h-5 animate-spin text-terra-500" />
          <div className="text-sm text-ink-200">{STATUS_LABELS[analysis.status]}</div>
        </div>
      )}

      {analysis.status === 'FAILED' && (
        <div className="bg-red-50 border border-red-300 px-5 py-4 mb-6">
          <div className="font-semibold text-red-800 mb-1 font-serif text-lg">הבדיקה נכשלה</div>
          <div className="text-sm text-red-700 font-mono">{analysis.errorMessage}</div>
        </div>
      )}

      {/* Render the sheet browser as soon as ANY rendered images exist (the
          deterministic preview lands ~10s after upload, well before the AI
          sheets finish). DxfPreview internally shows previews vs final sheets. */}
      {analysis.project?.dxfFile?.renderedImages ? (
        <DxfPreview
          dxfFileId={analysis.project.dxfFile.id}
          rendered={analysis.project.dxfFile.renderedImages}
        />
      ) : null}

      {done && (
        <>
          <div className="bg-paper-50 border border-ink-300/12 shadow-plate p-6 mb-8 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-1 h-full bg-terra-500/70" />
            <div className="flex items-center gap-8">
              <div className="text-center pl-6 border-l border-ink-300/15">
                <div className="font-serif text-5xl text-ink-300 leading-none tabular-nums">
                  {analysis.overallScore ?? 0}
                </div>
                <div className="font-mono text-[10px] text-ink-50 uppercase tracking-[0.2em] mt-2">
                  Overall Score
                </div>
              </div>
              <div className="grid grid-cols-4 gap-3 flex-1">
                <Stat icon={<CheckCircle2 className="w-4 h-4 text-emerald-700" />} n={analysis.passCount} label="עובר" />
                <Stat icon={<XCircle className="w-4 h-4 text-red-700" />} n={analysis.failCount} label="לא עובר" />
                <Stat icon={<AlertTriangle className="w-4 h-4 text-amber-700" />} n={analysis.warningCount} label="אזהרה" />
                <Stat icon={<HelpCircle className="w-4 h-4 text-ink-50" />} n={analysis.cannotCheckCount} label="לא נבדק" />
              </div>
            </div>
            {analysis.summary && (
              <div className="mt-5 pt-4 border-t border-ink-300/10 text-sm text-ink-200 leading-relaxed">
                {analysis.summary}
              </div>
            )}
          </div>

          <SectionHeader eyebrow="Core Compliance" title='דרישות התב"ע' />
          <ComplianceReport results={analysis.coreResults || []} />

          <div className="mt-12">
            <SectionHeader eyebrow="Optional Checks" title="בדיקות נוספות" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
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

      {viewAddon && viewAddon.run?.results && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-6 z-50" onClick={() => setViewAddon(null)}>
          <div className="bg-white rounded-lg max-w-3xl w-full max-h-[85vh] overflow-auto p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">{viewAddon.displayName}</h3>
              <button onClick={() => setViewAddon(null)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>
            {viewAddon.run.summary && (
              <div className="text-sm text-slate-700 mb-4 leading-relaxed">{viewAddon.run.summary}</div>
            )}
            <ComplianceReport results={viewAddon.run.results} />
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ icon, n, label }: { icon: JSX.Element; n: number | null; label: string }) {
  return (
    <div className="bg-paper-100/60 border border-ink-300/8 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-xs text-ink-100 mb-1">{icon}{label}</div>
      <div className="font-serif text-2xl text-ink-300 tabular-nums">{n ?? 0}</div>
    </div>
  );
}

function SectionHeader({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="mb-5 pb-3 border-b border-ink-300/15 flex items-end justify-between">
      <div>
        <div className="font-mono text-[10px] tracking-[0.22em] text-ink-50 uppercase mb-1">
          {eyebrow}
        </div>
        <h2 className="font-serif text-2xl text-ink-300 leading-tight">{title}</h2>
      </div>
    </div>
  );
}
