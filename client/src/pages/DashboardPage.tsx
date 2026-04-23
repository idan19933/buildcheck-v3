import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Search, FolderOpen, FileText } from 'lucide-react';
import { toast } from 'sonner';
import api from '../services/api';
import { useAuth } from '../hooks/useAuth';
import { Button, Card, EmptyState, ErrorState, SkeletonCard } from '../components/ui';
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

// Status → cover gradient (subtle, status-aware so the grid doesn't read monotone)
const STATUS_COVERS: Record<Project['status'], string> = {
  DRAFT:     'from-surface-muted via-surface-alt to-surface-muted',
  READY:     'from-brand-soft via-surface-alt to-brand-soft/40',
  ANALYZING: 'from-warning-soft via-surface-alt to-brand-soft/30',
  COMPLETED: 'from-success-soft via-surface-alt to-brand-soft/30',
};

const STATUS_RIBBON: Record<Project['status'], { bg: string; text: string }> = {
  DRAFT:     { bg: 'bg-surface-muted',      text: 'text-text-soft' },
  READY:     { bg: 'bg-brand text-white',   text: 'text-white' },
  ANALYZING: { bg: 'bg-warning text-white', text: 'text-white' },
  COMPLETED: { bg: 'bg-success text-white', text: 'text-white' },
};

function ProjectCard({ project }: { project: Project }) {
  const cover = STATUS_COVERS[project.status];
  const ribbon = STATUS_RIBBON[project.status];
  const hasFiles = !!project.dxfFile && !!project.tavaFile;

  return (
    <Link to={`/projects/${project.id}`} className="group block">
      <Card hoverable padded={false} className="overflow-hidden h-full flex flex-col">
        {/* Tinted cover — title-driven, status-tinted, no monogram. */}
        <div className={cn('relative aspect-[16/10] overflow-hidden bg-gradient-to-br', cover)}>
          {/* Subtle blueprint-grid texture */}
          <div
            className="absolute inset-0 opacity-[0.04] pointer-events-none"
            style={{
              backgroundImage:
                'linear-gradient(to right, var(--color-text) 1px, transparent 1px), linear-gradient(to bottom, var(--color-text) 1px, transparent 1px)',
              backgroundSize: '24px 24px',
            }}
          />
          {/* Status ribbon top-end (RTL: visually top-right) */}
          <div className="absolute top-3 end-3">
            <span className={cn('inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium', ribbon.bg)}>
              <span className={cn('h-1.5 w-1.5 rounded-full',
                project.status === 'COMPLETED' && 'bg-white',
                project.status === 'ANALYZING' && 'bg-white animate-pulse',
                project.status === 'READY'     && 'bg-white',
                project.status === 'DRAFT'     && 'bg-text-muted',
              )} />
              {STATUS_LABELS[project.status]}
            </span>
          </div>
          {/* Title is the cover — display weight, multi-line, anchored bottom */}
          <div className="absolute inset-x-0 bottom-0 p-4">
            <div className="text-2xl font-semibold text-text leading-tight tracking-tight line-clamp-2 group-hover:text-brand-dark transition-colors duration-fast">
              {project.name}
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="p-4 flex-1 flex flex-col gap-2">
          {project.locality && (
            <div className="flex items-center gap-1.5 text-xs text-text-soft">
              <FileText className="h-3.5 w-3.5 text-brand flex-shrink-0" />
              <span className="truncate">{project.locality}</span>
            </div>
          )}

          {project.description && (
            <p className="text-sm text-text-soft line-clamp-2">{project.description}</p>
          )}

          {/* Mini-stat row */}
          <div className="mt-auto flex items-center gap-3 pt-3 border-t border-border text-xs text-text-soft">
            <Stat n={project._count?.analyses ?? 0} label="בדיקות" />
            <span className="text-text-muted">·</span>
            <Stat n={(project.dxfFile ? 1 : 0) + (project.tavaFile ? 1 : 0)} label="קבצים" />
            {!hasFiles && project.status === 'DRAFT' && (
              <span className="ms-auto text-warning font-medium">דורש קבצים</span>
            )}
            {hasFiles && (
              <span className="ms-auto text-text-muted">{timeAgoHe(project.createdAt)}</span>
            )}
          </div>
        </div>
      </Card>
    </Link>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="font-semibold text-text font-latin tabular-nums" dir="ltr">{n}</span>
      <span>{label}</span>
    </span>
  );
}

// referenced for tone shape only — keeps tree-shaking happy
void scoreTone;
