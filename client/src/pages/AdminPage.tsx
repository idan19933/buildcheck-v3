import { useEffect, useState } from 'react';
import { Plus, Trash2, Users, FolderOpen, BarChart3 } from 'lucide-react';
import { toast } from 'sonner';
import api from '../services/api';
import { Badge, Button, Card, EmptyState, ErrorState, SkeletonCard, StatCard } from '../components/ui';

interface AdminUser {
  id: string; email: string; name: string; role: 'ADMIN' | 'MEMBER'; createdAt: string;
  _count?: { projects: number; analyses: number };
}

const fieldInputClass =
  'h-10 px-3 rounded-md border border-border bg-surface text-text placeholder:text-text-muted ' +
  'focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 transition-colors duration-fast';

export default function AdminPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [stats, setStats] = useState<{ userCount: number; projectCount: number; analysisCount: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'MEMBER' as 'ADMIN' | 'MEMBER' });

  const load = () => {
    setLoading(true); setError(null);
    Promise.all([
      api.get<{ users: AdminUser[] }>('/admin/users'),
      api.get<{ userCount: number; projectCount: number; analysisCount: number }>('/admin/stats'),
    ]).then(([u, s]) => {
      setUsers(u.data.users);
      setStats(s.data);
    }).catch((e) => setError(e instanceof Error ? e.message : 'נכשל לטעון נתונים'))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const tid = toast.loading('מוסיף משתמש…');
    try {
      await api.post('/admin/users', form);
      toast.success(`${form.name} נוסף בהצלחה`, { id: tid });
      setForm({ name: '', email: '', password: '', role: 'MEMBER' });
      setShowInvite(false);
      load();
    } catch (e) {
      const ax = e as { response?: { data?: { error?: string } } };
      toast.error(ax.response?.data?.error || 'הוספת המשתמש נכשלה', { id: tid });
    } finally { setBusy(false); }
  };

  const remove = async (u: AdminUser) => {
    if (!confirm(`למחוק את ${u.name}?`)) return;
    const tid = toast.loading('מוחק…');
    try {
      await api.delete(`/admin/users/${u.id}`);
      toast.success(`${u.name} נמחק`, { id: tid });
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'מחיקה נכשלה', { id: tid });
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-semibold text-text mb-1">ניהול</h1>
      <p className="text-text-soft mb-8">משתמשים, פרויקטים וסטטיסטיקות</p>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        {loading ? (
          <>
            <StatCard label="" value="" loading />
            <StatCard label="" value="" loading />
            <StatCard label="" value="" loading />
          </>
        ) : stats && (
          <>
            <StatCard label="משתמשים" value={stats.userCount} icon={<Users className="h-4 w-4" />} />
            <StatCard label="פרויקטים" value={stats.projectCount} icon={<FolderOpen className="h-4 w-4" />} />
            <StatCard label="בדיקות" value={stats.analysisCount} icon={<BarChart3 className="h-4 w-4" />} />
          </>
        )}
      </div>

      {/* Users header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold text-text">משתמשים</h2>
        <Button onClick={() => setShowInvite(!showInvite)} icon={<Plus className="h-4 w-4" />}>
          הוסף משתמש
        </Button>
      </div>

      {showInvite && (
        <Card className="mb-4">
          <form onSubmit={invite} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input placeholder="שם" required value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })} className={fieldInputClass} />
            <input placeholder="אימייל" type="email" required value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })} className={fieldInputClass} />
            <input placeholder="סיסמה (8+)" type="password" required minLength={8} value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })} className={fieldInputClass} />
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as 'ADMIN' | 'MEMBER' })}
              className={fieldInputClass}>
              <option value="MEMBER">MEMBER</option>
              <option value="ADMIN">ADMIN</option>
            </select>
            <div className="sm:col-span-2 flex justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={() => setShowInvite(false)}>ביטול</Button>
              <Button type="submit" loading={busy}>הוסף משתמש</Button>
            </div>
          </form>
        </Card>
      )}

      {/* Users table */}
      {loading ? (
        <SkeletonCard />
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : users.length === 0 ? (
        <EmptyState icon={<Users className="h-8 w-8" />} title="אין משתמשים" />
      ) : (
        <Card padded={false} className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface-muted text-xs text-text-soft text-start">
              <tr>
                <th className="p-3 text-start font-medium">שם</th>
                <th className="p-3 text-start font-medium">אימייל</th>
                <th className="p-3 text-start font-medium">תפקיד</th>
                <th className="p-3 text-start font-medium">פרויקטים</th>
                <th className="p-3" aria-label="פעולות"></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-t border-border hover:bg-surface-alt/50 transition-colors duration-fast">
                  <td className="p-3 font-medium text-text">{u.name}</td>
                  <td className="p-3 text-text-soft font-latin" dir="ltr">{u.email}</td>
                  <td className="p-3">
                    <Badge tone={u.role === 'ADMIN' ? 'brand' : 'neutral'}>{u.role}</Badge>
                  </td>
                  <td className="p-3 text-text-soft tabular-nums font-latin" dir="ltr">{u._count?.projects ?? 0}</td>
                  <td className="p-3 text-end">
                    <button onClick={() => remove(u)} aria-label={`מחק את ${u.name}`}
                      className="p-1.5 text-text-muted hover:text-danger hover:bg-danger-soft rounded-md transition-colors duration-fast">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
