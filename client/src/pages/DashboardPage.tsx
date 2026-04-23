import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Search, FolderOpen, FileText } from 'lucide-react';
import { toast } from 'sonner';
import api from '../services/api';
import { useAuth } from '../hooks/useAuth';
import { Badge, Button, Card, EmptyState, ErrorState, SkeletonCard } from '../components/ui';
import { cn, scoreTone, timeAgoHe } from '../lib/utils';
import type { Project } from '../types';

const STATUS_LABELS: Record<Project['status'], string> = {
  DRAFT: 'טיוטה',
  READY: 'מוכן לבדיקה',
  ANALYZING: 'בבדיקה',
  COMPLETED: 'הושלם',
};

const STATUS_TONES: Record<Project['status'], 'neutral' | 'brand' | 'warning' | 'success'> = {
  DRAFT: 'neutral',
  READY: 'brand',
  ANALYZING: 'warning',
  COMPLETED: 'success',
};

export default function DashboardPage() {
  const { user } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const load = () => {
    setLoading(true); setError(null);
    api.get<{ projects: Project[] }>('/projects')
      .then((r) => setProjects(r.data.projects))
      .catch((e) => setError(e instanceof Error ? e.message : 'נכשל לטעון פרויקטים'))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) =>
      p.name.toLowerCase().includes(q) ||
      (p.locality || '').toLowerCase().includes(q),
    );
  }, [projects, query]);

  return (
    <div>
      {/* Hero */}
      <div className="mb-10">
        <h1 className="text-3xl font-semibold text-text mb-2">
          שלום, {user?.name || 'אורח'}
        </h1>
        <p className="text-text-soft">ניתוח התאמה להיתרי בנייה — הפרויקטים שלך</p>
      </div>

      {/* Action bar */}
      <div className="flex items-center justify-between mb-6 gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute end-3 top-1/2 -translate-y-1/2 text-text-muted h-4 w-4 pointer-events-none" />
          <input
            type="text"
            placeholder="חיפוש פרויקט..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full h-10 pe-10 ps-4 rounded-md border border-border bg-surface text-text placeholder:text-text-muted focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
          />
        </div>
        <Link to="/new" aria-label="ניתוח חדש">
          <Button variant="primary" icon={<Plus className="h-4 w-4" />}>ניתוח חדש</Button>
        </Link>
      </div>

      {/* Body */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : projects.length === 0 ? (
        <EmptyState
          icon={<FolderOpen className="h-8 w-8" />}
          title="עדיין אין פרויקטים"
          description="צור ניתוח חדש כדי להתחיל. תוכל להעלות קבצי DXF ומסמכי תב״ע."
          action={
            <Link to="/new"><Button variant="primary" icon={<Plus className="h-4 w-4" />}>ניתוח חדש</Button></Link>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Search className="h-8 w-8" />}
          title="לא נמצאו פרויקטים"
          description={`אין פרויקט שמכיל את "${query}". נסה חיפוש אחר.`}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filtered.map((p) => <ProjectCard key={p.id} project={p} />)}
        </div>
      )}
    </div>
  );
}

function ProjectCard({ project }: { project: Project }) {
  const initials = (project.name || '?').slice(0, 2);
  // Score-tinted gradient placeholder; if there's a render thumbnail we'd use it here.
  const score = project._count?.analyses ? null : null; // hook for future overallScore aggregation

  return (
    <Link to={`/projects/${project.id}`} className="group block">
      <Card hoverable padded={false} className="overflow-hidden h-full flex flex-col">
        {/* 16:10 thumbnail / placeholder */}
        <div className="aspect-[16/10] bg-gradient-to-br from-brand-soft via-surface-muted to-brand-soft/40 relative overflow-hidden">
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-5xl font-semibold text-brand-dark/30 font-latin tracking-tight" dir="ltr">
              {initials}
            </div>
          </div>
          <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-surface/80 to-transparent" />
        </div>

        <div className="p-5 flex-1 flex flex-col">
          <div className="flex items-start gap-2 mb-3">
            <FileText className="h-4 w-4 text-brand mt-1 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-text truncate group-hover:text-brand-dark transition-colors duration-fast">
                {project.name}
              </h3>
              {project.locality && (
                <div className="text-xs text-text-soft truncate mt-0.5">{project.locality}</div>
              )}
            </div>
          </div>

          {project.description && (
            <p className="text-sm text-text-soft line-clamp-2 mb-3">{project.description}</p>
          )}

          <div className="mt-auto flex items-center justify-between gap-2 pt-3 border-t border-border">
            <Badge tone={STATUS_TONES[project.status]} dot>
              {STATUS_LABELS[project.status]}
            </Badge>
            <div className="flex items-center gap-3 text-xs text-text-muted">
              <span>{project._count?.analyses ?? 0} בדיקות</span>
              <span dir="ltr" className="font-latin">·</span>
              <span>{timeAgoHe(project.createdAt)}</span>
            </div>
          </div>
        </div>
      </Card>
    </Link>
  );
}

// referenced for tone shape only — keeps tree-shaking happy
void cn; void scoreTone;
