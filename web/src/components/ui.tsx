import { Loader2 } from 'lucide-react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { cx, DIFFICULTY_CLS, VERDICT } from '../lib/format';
import type { Difficulty, Verdict } from '../lib/types';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-ember-500 text-ink-950 hover:bg-ember-400 font-semibold shadow-[0_0_0_1px_rgba(249,115,22,.4),0_8px_24px_-12px_rgba(249,115,22,.6)]',
  secondary: 'bg-ink-800 text-ink-100 hover:bg-ink-700 border border-ink-700',
  ghost: 'text-ink-300 hover:text-ink-100 hover:bg-ink-800',
  danger: 'bg-rose-600/90 text-white hover:bg-rose-500',
  success: 'bg-emerald-500 text-ink-950 hover:bg-emerald-400 font-semibold',
};

export function Button({ variant = 'secondary', size = 'md', loading, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg'; loading?: boolean }) {
  const sz = size === 'sm' ? 'h-8 px-3 text-xs' : size === 'lg' ? 'h-11 px-6 text-sm' : 'h-9 px-4 text-sm';
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={cx('inline-flex items-center justify-center gap-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-ember-400 focus-visible:outline-offset-2 whitespace-nowrap', sz, VARIANTS[variant], className)}
    >
      {loading && <Loader2 className="size-4 animate-spin" />}
      {children}
    </button>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx('rounded-xl border border-ink-700/70 bg-ink-900/80', className)}>{children}</div>;
}

export function Badge({ className, children }: { className?: string; children: ReactNode }) {
  return <span className={cx('inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-none', className ?? 'border-ink-600 text-ink-300')}>{children}</span>;
}

export function VerdictBadge({ verdict, long, className }: { verdict: Verdict | null | undefined; long?: boolean; className?: string }) {
  if (!verdict) return <Badge>pending</Badge>;
  const v = VERDICT[verdict];
  return <Badge className={cx(v.cls, className)}>{long ? v.label : v.short}</Badge>;
}

export function Difficulty({ d }: { d: Difficulty }) {
  return <span className={cx('text-xs font-medium capitalize', DIFFICULTY_CLS[d])}>{d}</span>;
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx('size-5 animate-spin text-ink-400', className)} />;
}

export function PageLoader() {
  return <div className="flex h-64 items-center justify-center"><Spinner /></div>;
}

export function ErrorBox({ error }: { error: string | null | undefined }) {
  if (!error) return null;
  return <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</div>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-ink-700 px-6 py-10 text-center">
      <div className="text-sm font-medium text-ink-200">{title}</div>
      {children && <div className="mt-1 text-sm text-ink-400">{children}</div>}
    </div>
  );
}

const field = 'rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-sm text-ink-100 placeholder:text-ink-500 focus:border-ember-500/70 focus:outline-none focus:ring-2 focus:ring-ember-500/20';
/** Full width unless the caller sets a width (two width utilities would conflict). */
const width = (cls?: string) => (cls && /(^|\s)w-/.test(cls) ? '' : 'w-full');
export const Input = (p: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={cx(field, width(p.className), p.className)} />;
export const Textarea = (p: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...p} className={cx(field, width(p.className), 'font-mono text-[13px]', p.className)} />;
export const Select = (p: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={cx(field, width(p.className), 'pr-8', p.className)} />;

export function Label({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <div className="mb-1.5 flex items-baseline justify-between">
      <span className="text-xs font-medium uppercase tracking-wide text-ink-400">{children}</span>
      {hint && <span className="text-xs text-ink-500">{hint}</span>}
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange, className }: { tabs: { id: T; label: ReactNode }[]; value: T; onChange: (v: T) => void; className?: string }) {
  return (
    <div role="tablist" className={cx('flex items-center gap-1', className)}>
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cx('rounded-md px-3 py-1.5 text-xs font-medium transition-colors', value === t.id ? 'bg-ink-700 text-ink-100' : 'text-ink-400 hover:text-ink-200')}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Stat({ label, value, sub, className }: { label: string; value: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <div className={cx('rounded-xl border border-ink-700/70 bg-ink-900/80 px-4 py-3', className)}>
      <div className="text-xs text-ink-400">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-ink-100">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-ink-400">{sub}</div>}
    </div>
  );
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 py-1.5">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cx('relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors', checked ? 'bg-ember-500' : 'bg-ink-600')}
      >
        <span className={cx('absolute top-0.5 size-4 rounded-full bg-white transition-all', checked ? 'left-[18px]' : 'left-0.5')} />
      </button>
      <span>
        <span className="block text-sm text-ink-100">{label}</span>
        {hint && <span className="block text-xs text-ink-400">{hint}</span>}
      </span>
    </label>
  );
}
