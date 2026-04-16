import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, FileText, Loader2 } from 'lucide-react';
import api from '../services/api';
import type { Project } from '../types';

const STATUS_LABELS: Record<Project['status'], string> = {
  DRAFT: 'טיוטה',
  READY: 'מוכן לבדיקה',
  ANALYZING: 'בבדיקה',
  COMPLETED: 'הושלם',
};

export default function DashboardPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<{ projects: Project[] }>('/projects').then((r) => {
      setProjects(r.data.projects);
      setLoading(false);
    });
  }, []);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">פרויקטים</h1>
        <Link
          to="/new"
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded px-4 py-2 text-sm font-medium"
        >
          <Plus className="w-4 h-4" /> פרויקט חדש
        </Link>
      </div>

      {loading && <div className="flex items-center gap-2 text-slate-500"><Loader2 className="w-4 h-4 animate-spin" />טוען…</div>}

      {!loading && projects.length === 0 && (
        <div className="bg-white border border-dashed border-slate-300 rounded-lg p-10 text-center text-slate-500">
          אין פרויקטים עדיין. צור פרויקט חדש כדי להתחיל.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {projects.map((p) => (
          <Link
            key={p.id} to={`/projects/${p.id}`}
            className="bg-white border border-slate-200 rounded-lg p-4 hover:shadow-sm hover:border-indigo-300 transition"
          >
            <div className="flex items-start gap-2 mb-2">
              <FileText className="w-5 h-5 text-indigo-600 mt-1" />
              <div className="flex-1 min-w-0">
                <div className="font-semibold truncate">{p.name}</div>
                {p.locality && <div className="text-xs text-slate-500 truncate">{p.locality}</div>}
              </div>
            </div>
            <div className="flex items-center justify-between text-xs text-slate-500 mt-3">
              <span className="bg-slate-100 rounded px-2 py-0.5">{STATUS_LABELS[p.status]}</span>
              <span>{p._count?.analyses ?? 0} בדיקות</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
