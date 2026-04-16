import { useRef, useState } from 'react';
import { Play, Upload, Loader2, CheckCircle2, XCircle, AlertTriangle, Flame, Droplets, Zap, Accessibility } from 'lucide-react';
import api from '../services/api';
import type { AddonInfo, AddonDomain } from '../types';

const ICONS: Record<AddonDomain, JSX.Element> = {
  FIRE: <Flame className="w-5 h-5 text-orange-500" />,
  WATER: <Droplets className="w-5 h-5 text-sky-500" />,
  ELECTRICITY: <Zap className="w-5 h-5 text-amber-500" />,
  ACCESSIBILITY: <Accessibility className="w-5 h-5 text-teal-500" />,
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
  const [err, setErr] = useState<string | null>(null);

  const uploadDoc = async (file: File) => {
    setBusy(true); setErr(null);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('domain', info.domain);
      await api.post(`/projects/${projectId}/addon-docs`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      onChange();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Upload failed');
    } finally { setBusy(false); }
  };

  const runAgent = async () => {
    setBusy(true); setErr(null);
    try {
      await api.post(`/analyses/${analysisId}/addons/${info.domain}/run`);
      onChange();
    } catch (e) {
      const ax = e as { response?: { data?: { error?: string } } };
      setErr(ax.response?.data?.error || 'Run failed');
    } finally { setBusy(false); }
  };

  const run = info.run;
  const runStatus = run?.status;

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-4">
      <div className="flex items-center gap-2 mb-3">
        {ICONS[info.domain]}
        <div className="font-semibold">{info.displayName}</div>
      </div>

      {!info.hasDocument && (
        <>
          <div className="text-sm text-slate-500 mb-3">העלה מסמך תקנות/דרישות כדי להפעיל את הבודק.</div>
          <button
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="w-full flex items-center justify-center gap-2 bg-slate-100 hover:bg-slate-200 rounded px-3 py-2 text-sm disabled:opacity-50"
          >
            <Upload className="w-4 h-4" /> העלה מסמך
          </button>
        </>
      )}

      {info.hasDocument && !run && (
        <>
          <div className="text-xs text-slate-500 mb-2 truncate">מסמך: {info.documentName}</div>
          <button
            onClick={runAgent}
            disabled={busy}
            className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded px-3 py-2 text-sm disabled:opacity-50"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            הפעל בדיקה
          </button>
        </>
      )}

      {run && runStatus === 'RUNNING' && (
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <Loader2 className="w-4 h-4 animate-spin" /> מנתח…
        </div>
      )}

      {run && runStatus === 'COMPLETED' && (
        <>
          <div className="flex items-baseline gap-2 mb-2">
            <div className="text-2xl font-bold text-indigo-600">{run.score ?? 0}</div>
            <div className="text-xs text-slate-500">ציון</div>
          </div>
          <div className="grid grid-cols-4 gap-1 text-xs mb-3">
            <div className="text-center p-1 bg-emerald-50 rounded"><CheckCircle2 className="w-3 h-3 inline text-emerald-600" /> {run.passCount ?? 0}</div>
            <div className="text-center p-1 bg-red-50 rounded"><XCircle className="w-3 h-3 inline text-red-600" /> {run.failCount ?? 0}</div>
            <div className="text-center p-1 bg-amber-50 rounded"><AlertTriangle className="w-3 h-3 inline text-amber-600" /> {run.warningCount ?? 0}</div>
            <div className="text-center p-1 bg-slate-100 rounded">? {run.cannotCheckCount ?? 0}</div>
          </div>
          <button
            onClick={onView}
            className="w-full text-sm bg-slate-100 hover:bg-slate-200 rounded px-3 py-1.5"
          >
            הצג פירוט
          </button>
          <button
            onClick={runAgent}
            disabled={busy}
            className="w-full mt-2 text-xs text-slate-500 hover:text-slate-700"
          >
            הפעל שוב
          </button>
        </>
      )}

      {run && runStatus === 'FAILED' && (
        <div className="text-sm text-red-600 mb-2">שגיאה: {run.errorMessage}</div>
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
      {err && <div className="text-xs text-red-600 mt-2">{err}</div>}
    </div>
  );
}
