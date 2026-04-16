import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Building2 } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';

export default function LoginPage() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try { await login(email, password); nav('/'); }
    catch (e) {
      const ax = e as { response?: { data?: { error?: string } } };
      setErr(ax.response?.data?.error || 'התחברות נכשלה');
    } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50" dir="rtl">
      <form onSubmit={onSubmit} className="bg-white rounded-xl shadow-sm border border-slate-200 p-8 w-full max-w-sm">
        <div className="flex items-center gap-2 font-bold text-xl mb-6">
          <Building2 className="w-6 h-6 text-indigo-600" /> BuildCheck AI
        </div>
        <label className="block text-sm mb-1">אימייל</label>
        <input
          type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
          className="w-full mb-4 px-3 py-2 border border-slate-300 rounded"
        />
        <label className="block text-sm mb-1">סיסמה</label>
        <input
          type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
          className="w-full mb-4 px-3 py-2 border border-slate-300 rounded"
        />
        {err && <div className="text-sm text-red-600 mb-3">{err}</div>}
        <button
          type="submit" disabled={busy}
          className="w-full bg-indigo-600 hover:bg-indigo-700 text-white rounded py-2 font-medium disabled:opacity-50"
        >
          {busy ? 'מתחבר…' : 'התחבר'}
        </button>
        <div className="text-center mt-4 text-sm text-slate-500">
          אין חשבון? <Link to="/register" className="text-indigo-600">הרשם</Link>
        </div>
      </form>
    </div>
  );
}
