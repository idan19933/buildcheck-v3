import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Check, FileText, FileSpreadsheet, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import api from '../services/api';
import FileUpload from '../components/FileUpload';
import { Button, Card } from '../components/ui';
import { cn } from '../lib/utils';

type Step = 1 | 2 | 3 | 4;

const STEPS: { num: Step; label: string }[] = [
  { num: 1, label: 'פרטי הפרויקט' },
  { num: 2, label: 'העלאת DXF' },
  { num: 3, label: 'העלאת תב"ע' },
  { num: 4, label: 'סקירה והפעלה' },
];

const fieldInputClass =
  'w-full h-10 px-3 rounded-md border border-border bg-surface text-text placeholder:text-text-muted ' +
  'focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 transition-colors duration-fast';

export default function NewProjectPage() {
  const nav = useNavigate();
  const [step, setStep] = useState<Step>(1);
  const [form, setForm] = useState({ name: '', description: '', locality: '' });
  const [projectId, setProjectId] = useState<string | null>(null);
  const [dxfName, setDxfName] = useState<string | null>(null);
  const [tavaName, setTavaName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const createProject = async () => {
    if (!form.name.trim()) {
      setErrors({ name: 'שם הפרויקט נדרש' });
      return;
    }
    setBusy(true); setErrors({});
    try {
      const { data } = await api.post<{ project: { id: string } }>('/projects', form);
      setProjectId(data.project.id);
      toast.success('הפרויקט נוצר');
      setStep(2);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'יצירת הפרויקט נכשלה');
    } finally { setBusy(false); }
  };

  const uploadFile = async (kind: 'dxf' | 'tava', file: File) => {
    if (!projectId) return;
    const fd = new FormData(); fd.append('file', file);
    await api.post(`/uploads/${projectId}/${kind}`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
    if (kind === 'dxf') setDxfName(file.name); else setTavaName(file.name);
    toast.success(`${kind === 'dxf' ? 'DXF' : 'תב"ע'} הועלה בהצלחה`);
  };

  const startAnalysis = async () => {
    setBusy(true);
    const tid = toast.loading('מתחיל ניתוח…');
    try {
      const { data } = await api.post<{ analysisId: string }>(`/projects/${projectId}/analyze`);
      toast.success('הניתוח החל', { id: tid });
      nav(`/analyses/${data.analysisId}`);
    } catch (e) {
      const ax = e as { response?: { data?: { error?: string } } };
      toast.error(ax.response?.data?.error || 'הפעלת הניתוח נכשלה', { id: tid });
    } finally { setBusy(false); }
  };

  return (
    <div className="max-w-3xl mx-auto">
      <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-text-soft hover:text-brand transition-colors duration-fast mb-5">
        <ArrowRight className="h-4 w-4" />
        חזרה
      </Link>
      <h1 className="text-2xl font-semibold text-text mb-1">פרויקט חדש</h1>
      <p className="text-text-soft mb-8">צור ניתוח התאמה חדש בארבעה שלבים</p>

      <Stepper current={step} />

      <div className="mt-8">
        {step === 1 && (
          <Card>
            <h2 className="text-lg font-semibold text-text mb-1">פרטי הפרויקט</h2>
            <p className="text-sm text-text-soft mb-6">שם, יישוב ותיאור קצר</p>

            <div className="space-y-4">
              <Field label="שם הפרויקט" htmlFor="name" required error={errors.name}>
                <input id="name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className={fieldInputClass}
                  placeholder="למשל: בית מגורים — רחוב הגפן 12" />
              </Field>
              <Field label="יישוב" htmlFor="locality">
                <input id="locality" value={form.locality} onChange={(e) => setForm({ ...form, locality: e.target.value })}
                  className={fieldInputClass} />
              </Field>
              <Field label="תיאור" htmlFor="description">
                <textarea id="description" value={form.description} rows={3}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className={cn(fieldInputClass, 'h-auto py-2.5 resize-y min-h-[80px]')} />
              </Field>
            </div>

            <div className="flex justify-end mt-6">
              <Button onClick={createProject} loading={busy} disabled={!form.name}>
                המשך
              </Button>
            </div>
          </Card>
        )}

        {step === 2 && (
          <Card>
            <div className="flex items-start gap-3 mb-6">
              <div className="h-10 w-10 rounded-md bg-brand-soft text-brand-dark flex items-center justify-center flex-shrink-0">
                <FileText className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-text">העלאת בקשת ההיתר (DXF)</h2>
                <p className="text-sm text-text-soft mt-1">קובץ DXF של תוכניות הבנייה.</p>
              </div>
            </div>

            <FileUpload accept=".dxf" label="גרור לכאן או לחץ להעלאת DXF" currentName={dxfName}
              onUpload={(f) => uploadFile('dxf', f)} />

            <div className="flex justify-between mt-6">
              <Button variant="ghost" onClick={() => setStep(1)}>חזרה</Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setStep(3)}>דלג לעכשיו</Button>
                <Button onClick={() => setStep(3)} disabled={!dxfName}>המשך</Button>
              </div>
            </div>
          </Card>
        )}

        {step === 3 && (
          <Card>
            <div className="flex items-start gap-3 mb-6">
              <div className="h-10 w-10 rounded-md bg-brand-soft text-brand-dark flex items-center justify-center flex-shrink-0">
                <FileSpreadsheet className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-text">העלאת תב"ע / החלטה מרחבית (PDF)</h2>
                <p className="text-sm text-text-soft mt-1">מסמך הדרישות שאליו תשווה בקשת ההיתר.</p>
              </div>
            </div>

            <FileUpload accept=".pdf" label="גרור לכאן או לחץ להעלאת PDF" currentName={tavaName}
              onUpload={(f) => uploadFile('tava', f)} />

            <div className="flex justify-between mt-6">
              <Button variant="ghost" onClick={() => setStep(2)}>חזרה</Button>
              <Button onClick={() => setStep(4)} disabled={!tavaName}>המשך</Button>
            </div>
          </Card>
        )}

        {step === 4 && (
          <Card>
            <div className="flex items-start gap-3 mb-6">
              <div className="h-10 w-10 rounded-md bg-success-soft text-success flex items-center justify-center flex-shrink-0">
                <Sparkles className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-text">סקירה והפעלת ניתוח</h2>
                <p className="text-sm text-text-soft mt-1">ודא את הפרטים ולחץ "הפעל ניתוח".</p>
              </div>
            </div>

            <dl className="space-y-3 mb-6 text-sm">
              <SummaryRow term="פרויקט" desc={form.name} />
              {form.locality && <SummaryRow term="יישוב" desc={form.locality} />}
              <SummaryRow term="DXF" desc={dxfName ?? '—'} />
              <SummaryRow term='תב"ע' desc={tavaName ?? '—'} />
            </dl>

            <div className="flex justify-between">
              <Button variant="ghost" onClick={() => setStep(3)}>חזרה</Button>
              <Button
                onClick={startAnalysis}
                loading={busy}
                disabled={!dxfName || !tavaName}
                size="lg"
                icon={<Sparkles className="h-4 w-4" />}
              >
                הפעל ניתוח התאמה
              </Button>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

function Stepper({ current }: { current: Step }) {
  return (
    <ol className="flex items-center w-full gap-2">
      {STEPS.map((s, i) => {
        const done = current > s.num;
        const active = current === s.num;
        return (
          <li key={s.num} className="flex items-center flex-1 min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <div className={cn(
                'h-7 w-7 rounded-full flex items-center justify-center text-xs font-semibold transition-colors duration-base flex-shrink-0',
                done ? 'bg-brand text-white' :
                active ? 'bg-brand text-white shadow-sm ring-4 ring-brand/15' :
                'bg-surface-muted text-text-muted',
              )}>
                {done ? <Check className="h-4 w-4" /> : s.num}
              </div>
              <span className={cn(
                'text-sm font-medium truncate hidden sm:inline',
                active ? 'text-text' : done ? 'text-text-soft' : 'text-text-muted',
              )}>
                {s.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={cn(
                'flex-1 h-px mx-3 transition-colors duration-base',
                done ? 'bg-brand' : 'bg-border',
              )} />
            )}
          </li>
        );
      })}
    </ol>
  );
}

function Field({
  label, htmlFor, required, error, children,
}: { label: string; htmlFor: string; required?: boolean; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-sm font-medium text-text mb-1.5">
        {label}{required && <span className="text-danger ms-1">*</span>}
      </label>
      {children}
      {error && <div className="text-xs text-danger mt-1 animate-shake">{error}</div>}
    </div>
  );
}

function SummaryRow({ term, desc }: { term: string; desc: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3">
      <dt className="text-text-muted w-20 flex-shrink-0">{term}</dt>
      <dd className="text-text font-medium flex-1">{desc}</dd>
    </div>
  );
}
