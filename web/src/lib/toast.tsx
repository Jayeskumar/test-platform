import { CheckCircle2, Info, TriangleAlert, X } from 'lucide-react';
import { createContext, type ReactNode, useCallback, useContext, useState } from 'react';
import { cx } from './format';

type Kind = 'success' | 'error' | 'info';
interface Toast { id: number; kind: Kind; message: string }
interface ToastApi { success: (m: string) => void; error: (m: string) => void; info: (m: string) => void }

const Ctx = createContext<ToastApi | null>(null);
let next = 1;

const STYLE: Record<Kind, { icon: any; cls: string }> = {
  success: { icon: CheckCircle2, cls: 'text-emerald-300' },
  error: { icon: TriangleAlert, cls: 'text-rose-300' },
  info: { icon: Info, cls: 'text-sky-300' },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback((kind: Kind, message: string) => {
    const id = next++;
    setToasts((t) => [...t.slice(-3), { id, kind, message }]);
    setTimeout(() => dismiss(id), kind === 'error' ? 6000 : 3500);
  }, [dismiss]);
  const api: ToastApi = {
    success: useCallback((m: string) => push('success', m), [push]),
    error: useCallback((m: string) => push('error', m), [push]),
    info: useCallback((m: string) => push('info', m), [push]),
  };
  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="no-print pointer-events-none fixed right-4 bottom-4 z-[60] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2" aria-live="polite">
        {toasts.map((t) => {
          const S = STYLE[t.kind];
          return (
            <div key={t.id} role={t.kind === 'error' ? 'alert' : 'status'} className="pointer-events-auto flex items-start gap-3 rounded-xl border border-ink-700 bg-ink-900 px-4 py-3 text-sm text-ink-100 shadow-2xl shadow-black/20">
              <S.icon className={cx('mt-0.5 size-4 shrink-0', S.cls)} />
              <span className="flex-1">{t.message}</span>
              <button onClick={() => dismiss(t.id)} className="text-ink-500 hover:text-ink-200" aria-label="Dismiss"><X className="size-4" /></button>
            </div>
          );
        })}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useToast outside ToastProvider');
  return c;
}
