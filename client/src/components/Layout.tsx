import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { LogOut, LayoutGrid, Shield, Building2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../hooks/useAuth';
import { cn } from '../lib/utils';

export default function Layout() {
  const { user, logout } = useAuth();
  const nav = useNavigate();

  const onLogout = () => {
    logout();
    toast.success('התנתקת בהצלחה');
    nav('/login');
  };

  return (
    <div className="min-h-screen flex bg-surface-alt" dir="rtl">
      <aside className="w-64 bg-surface border-l border-border flex flex-col shadow-xs">
        {/* Brand */}
        <Link to="/" className="px-5 py-5 border-b border-border block group">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-md bg-brand text-white flex items-center justify-center shadow-sm group-hover:bg-brand-dark transition-colors duration-base">
              <Building2 className="h-5 w-5" />
            </div>
            <div>
              <div className="font-semibold text-base text-text leading-tight">BuildCheck AI</div>
              <div className="text-[11px] text-text-muted font-latin tracking-wide" dir="ltr">v3</div>
            </div>
          </div>
        </Link>

        {/* Nav */}
        <nav className="flex-1 p-3 space-y-1">
          <SideLink to="/" icon={<LayoutGrid className="h-4 w-4" />}>פרויקטים</SideLink>
          {user?.role === 'ADMIN' && (
            <SideLink to="/admin" icon={<Shield className="h-4 w-4" />}>ניהול</SideLink>
          )}
        </nav>

        {/* User */}
        <div className="p-3 border-t border-border">
          <div className="flex items-center gap-3 px-3 py-2 mb-2">
            <div className="h-9 w-9 rounded-full bg-brand-soft text-brand-dark font-semibold flex items-center justify-center text-sm">
              {(user?.name || '?').slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-medium text-sm text-text truncate">{user?.name}</div>
              <div className="text-xs text-text-muted truncate font-latin" dir="ltr">{user?.email}</div>
            </div>
          </div>
          <button
            onClick={onLogout}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm rounded-md text-text-soft hover:bg-surface-muted hover:text-text transition-colors duration-fast"
          >
            <LogOut className="h-4 w-4" /> התנתקות
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-auto">
        <div className="container max-w-7xl mx-auto py-8 px-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

function SideLink({ to, icon, children }: { to: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      end
      className={({ isActive }) => cn(
        'flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium',
        'transition-colors duration-fast',
        isActive
          ? 'bg-brand-soft text-brand-dark'
          : 'text-text-soft hover:bg-surface-muted hover:text-text',
      )}
    >
      {icon}
      {children}
    </NavLink>
  );
}
