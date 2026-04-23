import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Building2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../hooks/useAuth';
import { Button } from '../components/ui';

export default function LoginPage() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setFieldError(null);
    try {
      await login(email, password);
      toast.success('התחברת בהצלחה');
      nav('/');
    } catch (e) {
      const ax = e as { response?: { data?: { error?: string } } };
      const msg = ax.response?.data?.error || 'התחברות נכשלה';
      setFieldError(msg);
      toast.error(msg);
    } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-alt p-6" dir="rtl">
      <form
        onSubmit={onSubmit}
        className="bg-surface rounded-lg shadow-md border border-border p-8 w-full max-w-sm"
      >
        <div className="flex items-center gap-2.5 mb-1">
          <div className="h-10 w-10 rounded-md bg-brand text-white flex items-center justify-center shadow-sm">
            <Building2 className="h-5 w-5" />
          </div>
          <div className="font-semibold text-xl text-text">BuildCheck AI</div>
        </div>
        <p className="text-sm text-text-soft mb-6">ניתוח התאמה להיתרי בנייה</p>

        <Field label="אימייל" htmlFor="email">
          <input
            id="email" type="email" required autoComplete="email"
            value={email} onChange={(e) => setEmail(e.target.value)}
            className={fieldInputClass}
          />
        </Field>
        <Field label="סיסמה" htmlFor="password">
          <input
            id="password" type="password" required autoComplete="current-password"
            value={password} onChange={(e) => setPassword(e.target.value)}
            className={fieldInputClass}
          />
        </Field>

        {fieldError && (
          <div className="text-sm text-danger mb-4 animate-shake" role="alert">
            {fieldError}
          </div>
        )}

        <Button type="submit" loading={busy} className="w-full" size="lg">
          {busy ? 'מתחבר…' : 'התחבר'}
        </Button>
        <div className="text-center mt-5 text-sm text-text-soft">
          אין חשבון? <Link to="/register" className="text-brand hover:text-brand-dark font-medium">הרשם</Link>
        </div>
      </form>
    </div>
  );
}

const fieldInputClass =
  'w-full h-10 px-3 rounded-md border border-border bg-surface text-text placeholder:text-text-muted ' +
  'focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 transition-colors duration-fast';

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-text mb-1.5">{label}</label>
      {children}
    </div>
  );
}
