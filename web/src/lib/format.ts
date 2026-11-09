import type { Verdict } from './types';

export const VERDICT: Record<Verdict, { label: string; short: string; cls: string; dot: string }> = {
  AC: { label: 'Accepted', short: 'AC', cls: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30', dot: 'bg-emerald-400' },
  WA: { label: 'Wrong Answer', short: 'WA', cls: 'text-rose-300 bg-rose-500/10 border-rose-500/30', dot: 'bg-rose-400' },
  TLE: { label: 'Time Limit Exceeded', short: 'TLE', cls: 'text-amber-300 bg-amber-500/10 border-amber-500/30', dot: 'bg-amber-400' },
  MLE: { label: 'Memory Limit Exceeded', short: 'MLE', cls: 'text-orange-300 bg-orange-500/10 border-orange-500/30', dot: 'bg-orange-400' },
  RE: { label: 'Runtime Error', short: 'RE', cls: 'text-fuchsia-300 bg-fuchsia-500/10 border-fuchsia-500/30', dot: 'bg-fuchsia-400' },
  OLE: { label: 'Output Limit Exceeded', short: 'OLE', cls: 'text-orange-300 bg-orange-500/10 border-orange-500/30', dot: 'bg-orange-400' },
  CE: { label: 'Compilation Error', short: 'CE', cls: 'text-sky-300 bg-sky-500/10 border-sky-500/30', dot: 'bg-sky-400' },
  SE: { label: 'System Error', short: 'SE', cls: 'text-ink-300 bg-ink-700/40 border-ink-600', dot: 'bg-ink-400' },
  OK: { label: 'Finished', short: 'OK', cls: 'text-ink-200 bg-ink-700/40 border-ink-600', dot: 'bg-ink-300' },
};

export const DIFFICULTY_CLS = {
  easy: 'text-emerald-300',
  medium: 'text-amber-300',
  hard: 'text-rose-300',
};

export function ms(v: number | null | undefined) {
  if (v == null) return '—';
  return v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${v} ms`;
}

export function mem(kb: number | null | undefined) {
  if (kb == null) return '—';
  return kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`;
}

export function ago(t: number) {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

export function duration(msv: number) {
  const s = Math.max(0, Math.round(msv / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

export const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

export function cx(...xs: (string | false | null | undefined)[]) {
  return xs.filter(Boolean).join(' ');
}
