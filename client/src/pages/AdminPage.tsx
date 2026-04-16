import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import api from '../services/api';

interface AdminUser {
  id: string; email: string; name: string; role: 'ADMIN' | 'MEMBER'; createdAt: string;
  _count?: { projects: number; analyses: number };
}

export default function AdminPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [stats, setStats] = useState<{ userCount: number; projectCount: number; analysisCount: number } | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'MEMBER' as 'ADMIN' | 'MEMBER' });

  const load = async () => {
    const [u, s] = await Promise.all([
      api.get<{ users: AdminUser[] }>('/admin/users'),
      api.get<{ userCount: number; projectCount: number; analysisCount: number }>('/admin/stats'),
    ]);
    setUsers(u.data.users);
    setStats(s.data);
  };
  useEffect(() => { load(); }, []);

  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    await api.post('/admin/users', form);
    setForm({ name: '', email: '', password: '', role: 'MEMBER' });
    setShowInvite(false);
    load();
  };

  const remove = async (id: string) => {
    if (!confirm('למחוק משתמש?')) return;
    await api.delete(`/admin/users/${id}`);
    load();
  };

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">ניהול</h1>

      {stats && (
        <div className="grid grid-cols-3 gap-4 mb-8">
          <StatBox label="משתמשים" value={stats.userCount} />
          <StatBox label="פרויקטים" value={stats.projectCount} />
          <StatBox label="בדיקות" value={stats.analysisCount} />
        </div>
      )}

      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold">משתמשים</h2>
        <button onClick={() => setShowInvite(!showInvite)}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded px-3 py-1.5 text-sm">
          <Plus className="w-4 h-4" /> הוסף משתמש
        </button>
      </div>

      {showInvite && (
        <form onSubmit={invite} className="bg-white border border-slate-200 rounded-lg p-4 mb-4 grid grid-cols-2 gap-3">
          <input placeholder="שם" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="px-3 py-2 border border-slate-300 rounded text-sm" />
          <input placeholder="אימייל" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="px-3 py-2 border border-slate-300 rounded text-sm" />
          <input placeholder="סיסמה (8+)" type="password" required minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="px-3 py-2 border border-slate-300 rounded text-sm" />
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as 'ADMIN' | 'MEMBER' })} className="px-3 py-2 border border-slate-300 rounded text-sm">
            <option value="MEMBER">MEMBER</option>
            <option value="ADMIN">ADMIN</option>
          </select>
          <button type="submit" className="col-span-2 bg-indigo-600 text-white rounded py-2 text-sm">הוסף</button>
        </form>
      )}

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500 text-right">
            <tr><th className="p-3">שם</th><th className="p-3">אימייל</th><th className="p-3">תפקיד</th><th className="p-3">פרויקטים</th><th></th></tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t border-slate-100">
                <td className="p-3">{u.name}</td>
                <td className="p-3">{u.email}</td>
                <td className="p-3">{u.role}</td>
                <td className="p-3">{u._count?.projects ?? 0}</td>
                <td className="p-3"><button onClick={() => remove(u.id)} className="text-red-500"><Trash2 className="w-4 h-4" /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatBox({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-2xl font-bold mt-1">{value}</div>
    </div>
  );
}
