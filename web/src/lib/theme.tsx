import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react';

export type ThemeMode = 'system' | 'light' | 'dark';
interface ThemeState { mode: ThemeMode; resolved: 'light' | 'dark'; setMode: (m: ThemeMode) => void }

const Ctx = createContext<ThemeState | null>(null);
const media = () => window.matchMedia('(prefers-color-scheme: dark)');

function read(): ThemeMode {
  try {
    const v = localStorage.getItem('crucible:theme');
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(read);
  const [systemDark, setSystemDark] = useState(() => media().matches);
  useEffect(() => {
    const m = media();
    const h = () => setSystemDark(m.matches);
    m.addEventListener('change', h);
    return () => m.removeEventListener('change', h);
  }, []);
  const resolved = mode === 'system' ? (systemDark ? 'dark' : 'light') : mode;
  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolved === 'dark');
  }, [resolved]);
  const setMode = useCallback((m: ThemeMode) => {
    const root = document.documentElement;
    root.classList.add('theme-transition');
    setTimeout(() => root.classList.remove('theme-transition'), 300);
    try { localStorage.setItem('crucible:theme', m); } catch { /* private mode */ }
    setModeState(m);
  }, []);
  return <Ctx.Provider value={{ mode, resolved, setMode }}>{children}</Ctx.Provider>;
}

export function useTheme() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useTheme outside ThemeProvider');
  return c;
}
