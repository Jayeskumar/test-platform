import { BookOpen, Eye, EyeOff, Lightbulb, Lock } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { cx } from '../lib/format';
import { CodeEditor } from './CodeEditor';
import { Markdown } from './Markdown';
import { Button, ErrorBox, PageLoader } from './ui';

export interface LearnState {
  blocked: string | null;
  hintCount: number;
  hints: string[];
  editorial: { available: boolean; unlocked: boolean; reason: string };
}

/** Learning state for a practice problem; `refresh` re-checks after each submission. */
export function useLearn(slug: string, refresh: number) {
  const { user } = useAuth();
  const [state, setState] = useState<LearnState | null>(null);
  useEffect(() => {
    api.get<LearnState>(`/api/problems/${slug}/learn`).then(setState).catch(() => setState(null));
  }, [slug, refresh, user?.id]);
  return [state, setState] as const;
}

function Locked({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-ink-800 bg-ink-900/60 p-4 text-sm text-ink-300">
      <Lock className="mt-0.5 size-4 shrink-0 text-ink-400" aria-hidden />
      <div>{children}</div>
    </div>
  );
}

export function HintsPanel({ slug, state, onChange }: { slug: string; state: LearnState | null; onChange: (s: LearnState) => void }) {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!state) return <PageLoader />;
  if (state.blocked) return <Locked>{state.blocked}</Locked>;
  if (!state.hintCount) return <p className="text-sm text-ink-400">This problem has no hints.</p>;
  const next = state.hints.length + 1;
  const reveal = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api.post<{ hints: string[] }>(`/api/problems/${slug}/hints/${next}`);
      onChange({ ...state, hints: r.hints });
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-3">
      <p className="text-xs text-ink-400">Hints go from a gentle nudge to the key idea. Reveal one at a time and try again in between.</p>
      <ol className="space-y-2" aria-label="Hints">
        {Array.from({ length: state.hintCount }, (_, i) => {
          const text = state.hints[i];
          return (
            <li key={i} className={cx('rounded-lg border p-3 text-sm', text ? 'border-amber-500/30 bg-amber-500/5' : 'border-dashed border-ink-700 text-ink-500')}>
              <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-ink-400 uppercase">
                <Lightbulb className={cx('size-3.5', text ? 'text-amber-300' : 'text-ink-500')} aria-hidden /> Hint {i + 1}
              </div>
              {text ? <div className="prose-crucible [&_p]:m-0"><Markdown>{text}</Markdown></div> : <span className="flex items-center gap-1.5"><EyeOff className="size-3.5" aria-hidden /> Hidden</span>}
            </li>
          );
        })}
      </ol>
      {next <= state.hintCount && (user ? (
        <Button size="sm" onClick={reveal} loading={busy}><Eye className="size-4" /> Reveal hint {next}</Button>
      ) : (
        <p className="text-sm text-ink-400"><Link to="/login" className="text-ember-400 underline">Sign in</Link> to reveal hints.</p>
      ))}
      <ErrorBox error={err} />
    </div>
  );
}

export function EditorialPanel({ slug, state, refresh }: { slug: string; state: LearnState | null; refresh: number }) {
  const [data, setData] = useState<{ editorial: string; reason: string; reference: { language: string; code: string } | null } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showCode, setShowCode] = useState(false);
  const unlocked = !!state?.editorial.unlocked;
  useEffect(() => {
    if (!unlocked) return;
    api.get<typeof data>(`/api/problems/${slug}/editorial`).then(setData).catch((e) => setErr(e.message));
  }, [slug, unlocked, refresh]);
  if (!state) return <PageLoader />;
  if (state.blocked) return <Locked>{state.blocked}</Locked>;
  if (!state.editorial.available) return <p className="text-sm text-ink-400">This problem has no editorial yet.</p>;
  if (!unlocked) {
    return (
      <Locked>
        <div className="font-medium text-ink-100">The editorial is locked</div>
        <p className="mt-1 text-ink-400">{state.editorial.reason} Working through the problem first is how it sticks — try the hints if you are stuck.</p>
      </Locked>
    );
  }
  if (err) return <ErrorBox error={err} />;
  if (!data) return <PageLoader />;
  return (
    <article aria-label="Editorial" className="space-y-4">
      <div className="flex items-center gap-2 text-xs text-emerald-300"><BookOpen className="size-4" aria-hidden /> {data.reason}</div>
      <div className="prose-crucible"><Markdown>{data.editorial}</Markdown></div>
      {data.reference && (
        <div>
          <Button size="sm" onClick={() => setShowCode((v) => !v)} aria-expanded={showCode}>
            {showCode ? <EyeOff className="size-4" /> : <Eye className="size-4" />} {showCode ? 'Hide' : 'Show'} reference solution ({data.reference.language})
          </Button>
          {showCode && (
            <div className="mt-2 overflow-hidden rounded-lg border border-ink-800">
              <CodeEditor value={data.reference.code} language={data.reference.language} readOnly ariaLabel="Reference solution" />
            </div>
          )}
        </div>
      )}
    </article>
  );
}
