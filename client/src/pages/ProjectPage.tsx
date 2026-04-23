import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowRight, Play, FileText, FilePlus, MapPin, Inbox } from 'lucide-react';
import { toast } from 'sonner';
import api from '../services/api';
import { Badge, Button, Card, EmptyState, ErrorState, SkeletonCard } from '../components/ui';
import { scoreTone, timeAgoHe } from '../lib/utils';
import type { Project, Analysis } from '../types';

const ANALYSIS_STATUS: Record<string, { label: string; tone: 'neutral' | 'brand' | 'success' | 'warning' | 'danger' }> = {
  PENDING:        { label: 'ממתין',           tone: 'neutral' },
  EXTRACTING_DXF: { label: 'מחלץ DXF',        tone: 'brand'   },
  EXTRACTING_TAVA:{ label: 'מחלץ תב"ע',        tone: 'brand'   },
  ANALYZING:      { label: 'בודק תאימות',     tone: 'brand'   },
  COMPLETED:      { label: 'הושלם',           tone: 'success' },
  FAILED:         { label: 'נכשל',            tone: 'danger'  },
};

export default function ProjectPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const [project, setProject] = useState<(Project & { analyses?: Analysis[] }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [analyses, setAnalyses] = useState<Analysis[]>([]);
  const [busy, setBusy] = useState(false);

  const load = () => {
    setLoading(true); setError(null);
    api.get<{ project: Project & { analyses: Analysis[] } }>(`/projects/${id}`)
      .then((r) => {
        setProject(r.data.project);
        setAnalyses(r.data.project.analyses || []);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'נכשל לטעון פרויקט'))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  const runAnalysis = async () => {
    setBusy(true);
    const tid = toast.loading('מתחיל בדיקה חדשה…');
    try {
      const { data } = await api.post<{ analysisId: string }>(`/projects/${id}/analyze`);
      toast.success('הבדיקה החלה', { id: tid });
      nav(`/analyses/${data.analysisId}`);
    } catch (e) {
      const ax = e as { response?: { data?: { error?: string } } };
      toast.error(ax.response?.data?.error || 'הפעלת הבדיקה נכשלה', { id: tid });
    } finally { setBusy(false); }
  };

  if (loading) return <div className="space-y-5"><SkeletonCard /><SkeletonCard /></div>;
  if (error) return <ErrorState technical={error} onRetry={load} />;
  if (!project) return null;

  const ready = !!project.dxfFile && !!project.tavaFile;

  return (
    <div>
      <BackLink to="/" />
      <header className="mb-8">
        <h1 className="text-2xl font-semibold text-text mb-1">{project.name}</h1>
        {project.locality && (
          <div className="flex items-center gap-1.5 text-text-soft text-sm">
            <MapPin className="h-3.5 w-3.5" />
            {project.locality}
          </div>
        )}
        {project.description && (
          <p className="text-text-soft mt-3 max-w-2xl">{project.description}</p>
        )}
      </header>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        <FileCard
          title='בקשת היתר (DXF)'
          name={project.dxfFile?.originalName}
          icon={<FileText className="h-5 w-5" />}
        />
        <FileCard
          title='תב"ע (PDF)'
          name={project.tavaFile?.originalName}
          icon={<FileText className="h-5 w-5" />}
        />
      </section>

      <div className="flex items-center gap-3 mb-10">
        <Button
          onClick={runAnalysis}
          disabled={!ready}
          loading={busy}
          icon={<Play className="h-4 w-4" />}
          size="lg"
        >
          הפעל בדיקת תאימות חדשה
        </Button>
        {!ready && (
          <span className="text-sm text-text-muted">
            {!project.dxfFile && !project.tavaFile ? 'יש להעלות DXF ותב"ע תחילה' :
             !project.dxfFile ? 'יש להעלות DXF תחילה' :
             'יש להעלות תב"ע תחילה'}
          </span>
        )}
      </div>

      <section>
        <h2 className="text-xl font-semibold text-text mb-4">היסטוריית בדיקות</h2>
        {analyses.length === 0 ? (
          <EmptyState
            icon={<Inbox className="h-8 w-8" />}
            title="עדיין אין בדיקות"
            description={'הפעל בדיקה ראשונה כדי לראות תוצאות התאמה לדרישות התב"ע.'}
          />
        ) : (
          <div className="space-y-3">
            {analyses.map((a) => <AnalysisRow key={a.id} a={a} />)}
          </div>
        )}
      </section>
    </div>
  );
}

function FileCard({ title, name, icon }: { title: string; name?: string | null; icon: React.ReactNode }) {
  return (
    <Card>
      <div className="flex items-start gap-3">
        <div className={`h-10 w-10 rounded-md flex items-center justify-center flex-shrink-0 ${name ? 'bg-success-soft text-success' : 'bg-surface-muted text-text-muted'}`}>
          {name ? icon : <FilePlus className="h-5 w-5" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-text mb-0.5">{title}</div>
          <div className={`text-sm truncate ${name ? 'text-text-soft' : 'text-text-muted italic'}`}>
            {name || 'לא הועלה'}
          </div>
        </div>
      </div>
    </Card>
  );
}

function AnalysisRow({ a }: { a: Analysis }) {
  const meta = ANALYSIS_STATUS[a.status] || { label: a.status, tone: 'neutral' as const };
  const tone = scoreTone(a.overallScore);
  const scoreColors: Record<string, string> = {
    success: 'text-success',
    warning: 'text-warning',
    danger:  'text-danger',
    neutral: 'text-text-muted',
  };
  return (
    <Link
      to={`/analyses/${a.id}`}
      className="block bg-surface border border-border rounded-md p-4 hover:border-brand/40 hover:shadow-sm transition-all duration-base"
    >
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <Badge tone={meta.tone} dot>{meta.label}</Badge>
          <span className="text-xs text-text-muted">{timeAgoHe(a.startedAt)}</span>
        </div>
        {a.overallScore != null && (
          <div className={`text-2xl font-semibold tabular-nums font-latin ${scoreColors[tone]}`} dir="ltr">
            {a.overallScore}
          </div>
        )}
      </div>
      {a.summary && (
        <div className="text-sm text-text-soft line-clamp-2 mt-2">{a.summary}</div>
      )}
    </Link>
  );
}

function BackLink({ to }: { to: string }) {
  return (
    <Link to={to} className="inline-flex items-center gap-1.5 text-sm text-text-soft hover:text-brand transition-colors duration-fast mb-5">
      <ArrowRight className="h-4 w-4" />
      חזרה
    </Link>
  );
}
