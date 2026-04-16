import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Play, Loader2 } from 'lucide-react';
import api from '../services/api';
import type { Project, Analysis } from '../types';

export default function ProjectPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [analyses, setAnalyses] = useState<Analysis[]>([]);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const { data } = await api.get<{ project: Project & { analyses: Analysis[] } }>(`/projects/${id}`);
    setProject(data.project);
    setAnalyses(data.project.analyses || []);
  };
  useEffect(() => { load(); }, [id]);

  const runAnalysis = async () => {
    setBusy(true);
    try {
      const { data } = await api.post<{ analysisId: string }>(`/projects/${id}/analyze`);
      nav(`/analyses/${data.analysisId}`);
    } finally { setBusy(false); }
  };

  if (!project) return <div className="text-slate-500">טוען…</div>;

  const ready = !!project.dxfFile && !!project.tavaFile;

  return (
    <div>
      <button onClick={() => nav('/')} className="text-slate-500 text-sm mb-4 flex items-center gap-1">
        <ArrowLeft className="w-4 h-4" /> חזרה
      </button>
      <h1 className="text-2xl font-bold mb-1">{project.name}</h1>
      {project.locality && <div className="text-slate-500 text-sm mb-6">{project.locality}</div>}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-sm font-semibold mb-1">בקשת היתר (DXF)</div>
          <div className="text-sm text-slate-500 truncate">
            {project.dxfFile?.originalName || 'לא הועלה'}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-sm font-semibold mb-1">תב"ע (PDF)</div>
          <div className="text-sm text-slate-500 truncate">
            {project.tavaFile?.originalName || 'לא הועלה'}
          </div>
        </div>
      </div>

      <button
        onClick={runAnalysis} disabled={!ready || busy}
        className="bg-indigo-600 hover:bg-indigo-700 text-white rounded px-4 py-2 font-medium disabled:opacity-50 flex items-center gap-2 mb-8"
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
        הפעל בדיקת תאימות חדשה
      </button>

      <h2 className="text-lg font-semibold mb-3">היסטוריית בדיקות</h2>
      {analyses.length === 0 ? (
        <div className="text-slate-500 text-sm">אין בדיקות עדיין.</div>
      ) : (
        <div className="space-y-2">
          {analyses.map((a) => (
            <Link key={a.id} to={`/analyses/${a.id}`}
              className="block bg-white border border-slate-200 rounded p-3 hover:border-indigo-300">
              <div className="flex items-center justify-between">
                <div className="text-sm">
                  <span className="font-medium">{a.status}</span>
                  <span className="text-slate-500 mr-2">· {new Date(a.startedAt || Date.now()).toLocaleString('he-IL')}</span>
                </div>
                {a.overallScore != null && (
                  <div className="text-lg font-bold text-indigo-600">{a.overallScore}</div>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
