import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import FileUpload from '../components/FileUpload';
import { ArrowLeft, Loader2 } from 'lucide-react';

export default function NewProjectPage() {
  const nav = useNavigate();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [form, setForm] = useState({ name: '', description: '', locality: '' });
  const [projectId, setProjectId] = useState<string | null>(null);
  const [dxfName, setDxfName] = useState<string | null>(null);
  const [tavaName, setTavaName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const createProject = async () => {
    setBusy(true); setErr(null);
    try {
      const { data } = await api.post<{ project: { id: string } }>('/projects', form);
      setProjectId(data.project.id);
      setStep(2);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Create failed');
    } finally { setBusy(false); }
  };

  const uploadDxf = async (file: File) => {
    const fd = new FormData(); fd.append('file', file);
    await api.post(`/uploads/${projectId}/dxf`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
    setDxfName(file.name);
  };
  const uploadTava = async (file: File) => {
    const fd = new FormData(); fd.append('file', file);
    await api.post(`/uploads/${projectId}/tava`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
    setTavaName(file.name);
  };

  const startAnalysis = async () => {
    setBusy(true); setErr(null);
    try {
      const { data } = await api.post<{ analysisId: string }>(`/projects/${projectId}/analyze`);
      nav(`/analyses/${data.analysisId}`);
    } catch (e) {
      const ax = e as { response?: { data?: { error?: string } } };
      setErr(ax.response?.data?.error || 'Analysis failed');
    } finally { setBusy(false); }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <button onClick={() => nav('/')} className="text-slate-500 text-sm mb-4 flex items-center gap-1">
        <ArrowLeft className="w-4 h-4" /> חזרה
      </button>
      <h1 className="text-2xl font-bold mb-1">פרויקט חדש</h1>
      <div className="text-slate-500 text-sm mb-6">שלב {step} מתוך 4</div>

      {step === 1 && (
        <div className="bg-white border border-slate-200 rounded-lg p-6 space-y-4">
          <div>
            <label className="block text-sm mb-1">שם הפרויקט</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full px-3 py-2 border border-slate-300 rounded" placeholder="למשל: בית מגורים — רחוב הגפן 12" />
          </div>
          <div>
            <label className="block text-sm mb-1">יישוב</label>
            <input value={form.locality} onChange={(e) => setForm({ ...form, locality: e.target.value })}
              className="w-full px-3 py-2 border border-slate-300 rounded" />
          </div>
          <div>
            <label className="block text-sm mb-1">תיאור</label>
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={3} className="w-full px-3 py-2 border border-slate-300 rounded" />
          </div>
          <button onClick={createProject} disabled={!form.name || busy}
            className="bg-indigo-600 hover:bg-indigo-700 text-white rounded px-4 py-2 disabled:opacity-50">
            {busy ? 'יוצר…' : 'המשך'}
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="bg-white border border-slate-200 rounded-lg p-6">
          <h2 className="font-semibold mb-1">העלאת בקשת ההיתר (DXF)</h2>
          <p className="text-sm text-slate-500 mb-4">קובץ DXF של תוכניות הבנייה.</p>
          <FileUpload accept=".dxf" label="גרור לכאן או לחץ להעלאת DXF" currentName={dxfName} onUpload={uploadDxf} />
          <div className="flex gap-2 mt-4">
            <button onClick={() => setStep(3)} disabled={!dxfName}
              className="bg-indigo-600 hover:bg-indigo-700 text-white rounded px-4 py-2 disabled:opacity-50">המשך</button>
            <button onClick={() => setStep(3)} className="text-slate-500 text-sm">דלג לעכשיו</button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="bg-white border border-slate-200 rounded-lg p-6">
          <h2 className="font-semibold mb-1">העלאת תב"ע / החלטה מרחבית (PDF)</h2>
          <p className="text-sm text-slate-500 mb-4">מסמך הדרישות שאליו תשווה בקשת ההיתר.</p>
          <FileUpload accept=".pdf" label="גרור לכאן או לחץ להעלאת PDF" currentName={tavaName} onUpload={uploadTava} />
          <div className="flex gap-2 mt-4">
            <button onClick={() => setStep(4)} disabled={!tavaName}
              className="bg-indigo-600 hover:bg-indigo-700 text-white rounded px-4 py-2 disabled:opacity-50">המשך</button>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="bg-white border border-slate-200 rounded-lg p-6">
          <h2 className="font-semibold mb-4">סיכום והפעלה</h2>
          <div className="space-y-2 text-sm mb-6">
            <div><span className="text-slate-500">פרויקט: </span>{form.name}</div>
            <div><span className="text-slate-500">DXF: </span>{dxfName ?? '—'}</div>
            <div><span className="text-slate-500">תב"ע: </span>{tavaName ?? '—'}</div>
          </div>
          {err && <div className="text-sm text-red-600 mb-3">{err}</div>}
          <button onClick={startAnalysis} disabled={busy || !dxfName || !tavaName}
            className="bg-indigo-600 hover:bg-indigo-700 text-white rounded px-4 py-2 font-medium disabled:opacity-50 flex items-center gap-2">
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            הפעל בדיקת תאימות
          </button>
        </div>
      )}
    </div>
  );
}
