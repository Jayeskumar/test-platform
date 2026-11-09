import { Flame, LogOut } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { isStaff, useAuth } from '../lib/auth';
import { cx } from '../lib/format';

export function Logo({ className }: { className?: string }) {
  return (
    <Link to="/" className={cx('flex items-center gap-2 font-semibold tracking-tight text-ink-100', className)}>
      <span className="grid size-7 place-items-center rounded-lg bg-gradient-to-b from-amber-400 to-ember-600 text-ink-950"><Flame className="size-4" strokeWidth={2.5} /></span>
      Crucible
    </Link>
  );
}

const linkCls = ({ isActive }: { isActive: boolean }) =>
  cx('rounded-md px-3 py-1.5 text-sm transition-colors', isActive ? 'bg-ink-800 text-ink-100' : 'text-ink-400 hover:text-ink-100');

export function TopNav() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  return (
    <header className="sticky top-0 z-30 border-b border-ink-800 bg-ink-950/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-2 px-4">
        <Logo className="mr-4" />
        <nav className="flex min-w-0 items-center gap-1 overflow-x-auto" aria-label="Main">
          <NavLink to="/problems" className={linkCls}>Practice</NavLink>
          <NavLink to="/leaderboard" className={linkCls}>Leaderboard</NavLink>
          {user && <NavLink to="/dashboard" className={linkCls}>Progress</NavLink>}
          {isStaff(user) && <NavLink to="/hiring" className={linkCls}>Hiring</NavLink>}
          {isStaff(user) && <NavLink to="/library" className={linkCls}>Library</NavLink>}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {user ? (
            <>
              <span className="hidden text-sm text-ink-300 sm:inline">{user.name}</span>
              <span className="hidden rounded bg-ink-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-ink-400 sm:inline">{user.role}</span>
              <button onClick={async () => { await logout(); nav('/'); }} className="rounded-md p-2 text-ink-400 hover:bg-ink-800 hover:text-ink-100" aria-label="Sign out" title="Sign out">
                <LogOut className="size-4" />
              </button>
            </>
          ) : (
            <>
              <Link to="/login" className="rounded-md px-3 py-1.5 text-sm whitespace-nowrap text-ink-300 hover:text-ink-100">Sign in</Link>
              <Link to="/register" className="hidden rounded-lg bg-ember-500 px-3 py-1.5 text-sm font-semibold whitespace-nowrap text-ink-950 hover:bg-ember-400 sm:inline-block">Get started</Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

export function Page({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return <main className={cx('mx-auto px-4 py-8', wide ? 'max-w-[1500px]' : 'max-w-7xl')}>{children}</main>;
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink-100">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-400">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
