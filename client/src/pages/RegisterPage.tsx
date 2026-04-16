import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Building2 } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';

export default function RegisterPage() {
  const { register } = useAuth();
  const nav = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '', companyName: '' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try { await register(form.email, form.password, form.name, form.companyName); nav('/'); }
    catch (e) {
      const ax = e as { response?: { data?: { error?: string } } };
      setErr(ax.response?.data?.error || 'הרשמה נכשלה');
    } finally { setBusy(false); }
  };

  const upd = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [k]: e.target.value });

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50" dir="rtl">
      <form onSubmit={onSubmit} className="bg-white rounded-xl shadow-sm border border-slate-200 p-8 w-full max-w-sm">
        <div className="flex items-center gap-2 font-bold text-xl mb-6">
          <Building2 className="w-6 h-6 text-indigo-600" /> הרשמה
        </div>
        <label className="block text-sm mb-1">שם מלא</label>
        <input required value={form.name} onChange={upd('name')} className="w-full mb-3 px-3 py-2 border border-slate-300 rounded" />
        <label className="block text-sm mb-1">שם החברה</label>
        <input required value={form.companyName} onChange={upd('companyName')} className="w-full mb-3 px-3 py-2 border border-slate-300 rounded" />
        <label className="block text-sm mb-1">אימייל</label>
        <input type="email" required value={form.email} onChange={upd('email')} className="w-full mb-3 px-3 py-2 border border-slate-300 rounded" />
        <label className="block text-sm mb-1">סיסמה (8+ תווים)</label>
        <input type="password" required minLength={8} value={form.password} onChange={upd('password')} className="w-full mb-4 px-3 py-2 border border-slate-300 rounded" />
        {err && <div className="text-sm text-red-600 mb-3">{err}</div>}
        <button type="submit" disabled={busy} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white rounded py-2 font-medium disabled:opacity-50">
          {busy ? 'רושם…' : 'הרשם'}
        </button>
        <div className="text-center mt-4 text-sm text-slate-500">
          יש לך חשבון? <Link to="/login" className="text-indigo-600">התחבר</Link>
        </div>
      </form>
    </div>
  );
}
