import { Link, Outlet, useNavigate } from 'react-router-dom';
import { LogOut, Home, Shield, Building2 } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';

export default function Layout() {
  const { user, logout } = useAuth();
  const nav = useNavigate();

  const onLogout = () => {
    logout();
    nav('/login');
  };

  return (
    <div className="min-h-screen flex bg-slate-50" dir="rtl">
      <aside className="w-60 bg-white border-l border-slate-200 flex flex-col">
        <div className="px-5 py-6 border-b border-slate-200">
          <div className="flex items-center gap-2 font-bold text-lg">
            <Building2 className="w-6 h-6 text-indigo-600" />
            BuildCheck AI
          </div>
          <div className="text-xs text-slate-500 mt-1">v2</div>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          <Link to="/" className="flex items-center gap-2 px-3 py-2 rounded hover:bg-slate-100">
            <Home className="w-4 h-4" /> פרויקטים
          </Link>
          {user?.role === 'ADMIN' && (
            <Link to="/admin" className="flex items-center gap-2 px-3 py-2 rounded hover:bg-slate-100">
              <Shield className="w-4 h-4" /> ניהול
            </Link>
          )}
        </nav>
        <div className="p-3 border-t border-slate-200 text-sm">
          <div className="font-medium truncate">{user?.name}</div>
          <div className="text-xs text-slate-500 truncate">{user?.email}</div>
          <button
            onClick={onLogout}
            className="mt-2 w-full flex items-center justify-center gap-2 px-3 py-1.5 text-sm rounded bg-slate-100 hover:bg-slate-200"
          >
            <LogOut className="w-4 h-4" /> התנתקות
          </button>
        </div>
      </aside>
      <main className="flex-1 p-8 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
