import { Flame, LogOut, Menu, Monitor, Moon, Search, Sun, X } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { isStaff, useAuth } from '../lib/auth';
import { cx } from '../lib/format';
import { type ThemeMode, useTheme } from '../lib/theme';
import { openPalette } from './CommandPalette';

export function Logo({ className, to = '/' }: { className?: string; to?: string }) {
  return (
    <Link to={to} className={cx('flex items-center gap-2 font-semibold tracking-tight text-ink-100', className)}>
      <span className="grid size-7 place-items-center rounded-lg bg-gradient-to-b from-amber-400 to-ember-600 text-on-accent shadow-[0_4px_14px_-4px_rgba(249,115,22,.7)]"><Flame className="size-4" strokeWidth={2.5} /></span>
      Crucible
    </Link>
  );
}

const THEMES: { id: ThemeMode; label: string; icon: any }[] = [
  { id: 'light', label: 'Light', icon: Sun },
  { id: 'dark', label: 'Dark', icon: Moon },
  { id: 'system', label: 'System', icon: Monitor },
];

export function ThemeSwitch({ className }: { className?: string }) {
  const { mode, setMode } = useTheme();
  return (
    <div role="radiogroup" aria-label="Theme" className={cx('inline-flex rounded-lg border border-ink-700 bg-ink-850 p-0.5', className)}>
      {THEMES.map((t) => (
        <button
          key={t.id}
          role="radio"
          aria-checked={mode === t.id}
          title={t.label}
          onClick={() => setMode(t.id)}
          className={cx('grid h-7 w-8 place-items-center rounded-md transition-colors', mode === t.id ? 'bg-ink-700 text-ink-100' : 'text-ink-400 hover:text-ink-100')}
        >
          <t.icon className="size-3.5" />
          <span className="sr-only">{t.label}</span>
        </button>
      ))}
    </div>
  );
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';
}

function UserMenu() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', h);
    document.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k); };
  }, [open]);
  if (!user) return null;
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open} aria-label={`${initials(user.name)} — account menu`} className="grid size-8 place-items-center rounded-full bg-gradient-to-br from-ink-600 to-ink-700 text-xs font-semibold text-ink-100 ring-2 ring-transparent transition hover:ring-ember-500/40">
        {initials(user.name)}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 mt-2 w-64 overflow-hidden rounded-xl border border-ink-700 bg-ink-900 shadow-2xl shadow-black/25">
          <div className="border-b border-ink-800 px-4 py-3">
            <div className="truncate text-sm font-medium text-ink-100">{user.name}</div>
            <div className="truncate text-xs text-ink-400">{user.email}</div>
            <span className="mt-1.5 inline-block rounded bg-ink-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-ink-300">{user.role}</span>
          </div>
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-xs text-ink-400">Theme</span>
            <ThemeSwitch />
          </div>
          <button role="menuitem" onClick={async () => { setOpen(false); await logout(); nav('/'); }} className="flex w-full items-center gap-2 border-t border-ink-800 px-4 py-2.5 text-sm text-ink-200 hover:bg-ink-800">
            <LogOut className="size-4 text-ink-400" /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

const linkCls = ({ isActive }: { isActive: boolean }) =>
  cx('relative rounded-md px-3 py-1.5 text-sm transition-colors', isActive ? 'text-ink-100 after:absolute after:inset-x-3 after:-bottom-[13px] after:h-0.5 after:rounded-full after:bg-ember-500' : 'text-ink-400 hover:text-ink-100');

export function TopNav() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [mobile, setMobile] = useState(false);
  useEffect(() => setMobile(false), [loc.pathname]);
  const links = [
    { to: '/problems', label: 'Practice' },
    { to: '/leaderboard', label: 'Leaderboard' },
    ...(user ? [{ to: '/dashboard', label: 'Progress' }] : []),
    ...(isStaff(user) ? [{ to: '/hiring', label: 'Hiring' }, { to: '/library', label: 'Library' }] : []),
  ];
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  return (
    <header data-app-nav className="sticky top-0 z-30 border-b border-ink-800 bg-ink-950/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-2 px-4">
        <Logo className="mr-3" />
        <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
          {links.map((l) => <NavLink key={l.to} to={l.to} className={linkCls}>{l.label}</NavLink>)}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={openPalette} className="hidden h-8 items-center gap-2 rounded-lg border border-ink-700 bg-ink-900 pr-1.5 pl-2.5 text-xs text-ink-400 transition-colors hover:border-ink-600 hover:text-ink-200 sm:flex" title="Search (Ctrl+K)">
            <Search className="size-3.5" />
            <span className="sr-only lg:not-sr-only">Search…</span>
            <kbd className="rounded border border-ink-700 bg-ink-850 px-1 font-sans text-[10px]">{isMac ? '⌘' : 'Ctrl'} K</kbd>
          </button>
          {user ? (
            <div className="hidden md:block"><UserMenu /></div>
          ) : (
            <div className="hidden items-center gap-2 md:flex">
              <ThemeSwitch />
              <Link to="/login" className="rounded-md px-3 py-1.5 text-sm whitespace-nowrap text-ink-300 hover:text-ink-100">Sign in</Link>
              <Link to="/register" className="rounded-lg bg-ember-500 px-3 py-1.5 text-sm font-semibold whitespace-nowrap text-on-accent hover:bg-ember-400">Get started</Link>
            </div>
          )}
          <button onClick={() => setMobile(!mobile)} className="grid size-9 place-items-center rounded-lg text-ink-300 hover:bg-ink-800 md:hidden" aria-label={mobile ? 'Close menu' : 'Open menu'} aria-expanded={mobile}>
            {mobile ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
      </div>
      {mobile && (
        <div className="border-t border-ink-800 bg-ink-950 px-4 pt-2 pb-4 md:hidden">
          <nav className="flex flex-col" aria-label="Main">
            {links.map((l) => (
              <NavLink key={l.to} to={l.to} className={({ isActive }) => cx('rounded-lg px-3 py-2.5 text-sm', isActive ? 'bg-ink-800 text-ink-100' : 'text-ink-300')}>{l.label}</NavLink>
            ))}
            <button onClick={() => { setMobile(false); openPalette(); }} className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm text-ink-300"><Search className="size-4" /> Search</button>
          </nav>
          <div className="mt-3 flex items-center justify-between border-t border-ink-800 pt-3">
            <ThemeSwitch />
            {user ? (
              <button onClick={async () => { await logout(); nav('/'); }} className="flex items-center gap-2 text-sm text-ink-300"><LogOut className="size-4" /> Sign out</button>
            ) : (
              <div className="flex gap-2">
                <Link to="/login" className="rounded-lg px-3 py-1.5 text-sm text-ink-200">Sign in</Link>
                <Link to="/register" className="rounded-lg bg-ember-500 px-3 py-1.5 text-sm font-semibold text-on-accent">Get started</Link>
              </div>
            )}
          </div>
        </div>
      )}
    </header>
  );
}

export function Page({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return <main className={cx('mx-auto px-4 py-8', wide ? 'max-w-[1500px]' : 'max-w-7xl')}>{children}</main>;
}

export function PageHeader({ title, subtitle, actions, eyebrow }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-xs font-medium tracking-wide text-ember-300 uppercase">{eyebrow}</div>}
        <h1 className="text-2xl font-semibold tracking-tight text-ink-100 sm:text-[1.7rem]">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-400">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
