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
      <button onClick={() => nav(-1)} className="text-slate-500 text-sm mb-4 flex items-center gap-1">
        <ArrowLeft className="w-4 h-4" /> חזרה
      </button>
      <h1 className="text-2xl font-bold mb-1">בדיקת תאימות</h1>
      <div className="text-slate-500 text-sm mb-6">{STATUS_LABELS[analysis.status] || analysis.status}</div>

      {inProgress && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-5 flex items-center gap-3 mb-6">
          <Loader2 className="w-5 h-5 animate-spin text-indigo-600" />
          <div className="text-sm">{STATUS_LABELS[analysis.status]}</div>
        </div>
      )}

      {analysis.status === 'FAILED' && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-5 mb-6">
          <div className="font-semibold text-red-700 mb-1">הבדיקה נכשלה</div>
          <div className="text-sm text-red-600">{analysis.errorMessage}</div>
        </div>
      )}

      {done && analysis.project?.dxfFile?.renderedImages?.length ? (
        <DxfPreview
          dxfFileId={analysis.project.dxfFile.id}
          images={analysis.project.dxfFile.renderedImages}
        />
      ) : null}

      {done && (
        <>
          <div className="bg-white border border-slate-200 rounded-lg p-6 mb-6">
            <div className="flex items-center gap-6">
              <div>
                <div className="text-4xl font-bold text-indigo-600">{analysis.overallScore ?? 0}</div>
                <div className="text-xs text-slate-500">ציון כולל</div>
              </div>
              <div className="grid grid-cols-4 gap-3 flex-1">
                <Stat icon={<CheckCircle2 className="w-4 h-4 text-emerald-600" />} n={analysis.passCount} label="עובר" />
                <Stat icon={<XCircle className="w-4 h-4 text-red-600" />} n={analysis.failCount} label="לא עובר" />
                <Stat icon={<AlertTriangle className="w-4 h-4 text-amber-600" />} n={analysis.warningCount} label="אזהרה" />
                <Stat icon={<HelpCircle className="w-4 h-4 text-slate-500" />} n={analysis.cannotCheckCount} label="לא נבדק" />
              </div>
            </div>
            {analysis.summary && (
              <div className="mt-4 pt-4 border-t border-slate-200 text-sm text-slate-700 leading-relaxed">
                {analysis.summary}
              </div>
            )}
          </div>

          <h2 className="text-lg font-semibold mb-3">דרישות התב"ע</h2>
          <ComplianceReport results={analysis.coreResults || []} />

          <div className="mt-10 mb-3 flex items-center">
            <h2 className="text-lg font-semibold">בדיקות נוספות (אופציונלי)</h2>
            <div className="flex-1 h-px bg-slate-200 mr-4"></div>
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
    <div className="bg-slate-50 rounded p-3">
      <div className="flex items-center gap-1 text-xs text-slate-500 mb-1">{icon}{label}</div>
      <div className="text-xl font-semibold">{n ?? 0}</div>
    </div>
  );
}
