import { CheckCircle2, CircleDashed, Lock, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cx, mem, ms, VERDICT } from '../lib/format';
import type { TestResult } from '../lib/types';
import type { JudgeState } from '../lib/useJudge';
import { ComplexityCard } from './charts';
import { SqlTable } from './SqlTable';
import { Spinner, VerdictBadge } from './ui';

const PHASE_LABEL: Record<string, string> = {
  queued: 'Queued…',
  compiling: 'Compiling…',
  testing: 'Running tests…',
  complexity: 'Measuring complexity on growing inputs…',
};

function Pre({ label, text }: { label: string; text?: string }) {
  if (text == null) return null;
  return (
    <div>
      <div className="mb-1 text-[11px] uppercase tracking-wide text-ink-400">{label}</div>
      <pre className="max-h-48 overflow-auto rounded-md border border-ink-800 bg-ink-950 px-3 py-2 font-mono text-xs whitespace-pre-wrap text-ink-200">{text || <span className="text-ink-500">(empty)</span>}</pre>
    </div>
  );
}

function TestDetail({ r }: { r: TestResult }) {
  if (r.hidden) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-ink-800 bg-ink-950 px-3 py-3 text-sm text-ink-300">
        <Lock className="size-4 text-ink-400" /> Hidden test case. {r.message}
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {r.message && <div className={cx('rounded-md border px-3 py-2 text-xs', VERDICT[r.verdict].cls)}>{r.message}</div>}
      {r.table || r.expectedTable ? (
        <div className="grid gap-3 lg:grid-cols-2">
          <div><div className="mb-1 text-[11px] uppercase tracking-wide text-ink-400">Your result</div>{r.table ? <SqlTable table={r.table} /> : <div className="text-xs text-ink-400">—</div>}</div>
          <div><div className="mb-1 text-[11px] uppercase tracking-wide text-ink-400">Expected</div>{r.expectedTable && <SqlTable table={r.expectedTable} />}</div>
        </div>
      ) : (
        <>
          <Pre label="Input" text={r.input} />
          <div className="grid gap-3 lg:grid-cols-2">
            <Pre label="Your output" text={r.output} />
            {!r.custom && <Pre label="Expected" text={r.expected} />}
          </div>
          {r.stderr ? <Pre label="stderr" text={r.stderr} /> : null}
        </>
      )}
    </div>
  );
}

export function ResultsPanel({ state }: { state: JudgeState }) {
  const [sel, setSel] = useState(0);
  const sub = state.submission;
  const results = state.results;
  useEffect(() => {
    // Jump to the first failing visible test once judging is done.
    if (state.phase === 'done') {
      const bad = results.find((r) => r.verdict !== 'AC' && r.verdict !== 'OK');
      setSel(bad ? results.indexOf(bad) : 0);
    } else setSel(0);
  }, [state.phase, state.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (state.phase === 'idle') {
    return <div className="flex h-full items-center justify-center p-6 text-sm text-ink-400">Run your code against the sample tests, or submit to be judged on every test.</div>;
  }
  if (state.phase === 'error') return <div className="p-4 text-sm text-rose-300">{state.error}</div>;

  const running = state.phase !== 'done';
  const verdict = sub?.verdict;
  const ce = verdict === 'CE' || state.compile?.ok === false;
  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-ink-800 px-4 py-2.5">
        {running ? (
          <span className="flex items-center gap-2 text-sm text-ink-200"><Spinner className="size-4 text-ember-400" />{PHASE_LABEL[state.phase] ?? 'Working…'}</span>
        ) : (
          <span className={cx('text-base font-semibold', verdict === 'AC' ? 'text-emerald-300' : verdict === 'OK' ? 'text-ink-100' : 'text-rose-300')}>
            {verdict ? VERDICT[verdict].label : ''}
          </span>
        )}
        {sub && !ce && sub.total > 0 && (
          <span className="text-sm text-ink-300">{sub.passed}/{sub.total} tests passed{sub.kind === 'submit' && ` · score ${Math.round(sub.score * 100)}%`}</span>
        )}
        {sub && !ce && <span className="text-xs text-ink-400">max {ms(sub.timeMs)} · {mem(sub.memoryKb)}</span>}
        {running && state.total > 0 && <span className="text-xs text-ink-400">{results.length}/{state.total}</span>}
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {ce ? (
          <pre className="overflow-auto rounded-md border border-sky-500/20 bg-ink-950 p-3 font-mono text-xs whitespace-pre-wrap text-sky-200">{state.compile?.output || sub?.compileOutput}</pre>
        ) : (
          <>
            {state.compile?.ok && state.compile.output.trim() && (
              <details className="mb-3 text-xs text-ink-400"><summary className="cursor-pointer">Compiler warnings</summary><pre className="mt-1 overflow-auto font-mono whitespace-pre-wrap">{state.compile.output}</pre></details>
            )}
            <div className="mb-3 flex flex-wrap gap-1.5">
              {results.map((r, i) => (
                <button
                  key={r.index}
                  onClick={() => setSel(i)}
                  className={cx('flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors', sel === i ? 'border-ink-500 bg-ink-800' : 'border-ink-800 hover:border-ink-600')}
                  title={`${VERDICT[r.verdict].label} · ${ms(r.timeMs)} · ${mem(r.memoryKb)}`}
                >
                  {r.verdict === 'AC' || r.verdict === 'OK' ? <CheckCircle2 className="size-3.5 text-emerald-400" /> : <XCircle className="size-3.5 text-rose-400" />}
                  {r.custom ? 'Custom' : r.hidden ? `Hidden ${i + 1}` : `Test ${i + 1}`}
                </button>
              ))}
              {running && Array.from({ length: Math.max(0, state.total - results.length) || (state.total ? 0 : 1) }).map((_, i) => (
                <span key={`p${i}`} className="flex items-center gap-1.5 rounded-md border border-ink-800 px-2 py-1 text-xs text-ink-500"><CircleDashed className="size-3.5 animate-spin" />…</span>
              ))}
            </div>
            {results[sel] && (
              <div>
                <div className="mb-2 flex items-center gap-2 text-xs text-ink-400">
                  <VerdictBadge verdict={results[sel].verdict} long /> <span>{ms(results[sel].timeMs)}</span><span>·</span><span>{mem(results[sel].memoryKb)}</span>
                </div>
                <TestDetail r={results[sel]} />
              </div>
            )}
            {state.phase === 'complexity' && <div className="mt-4 flex items-center gap-2 text-xs text-ink-300"><Spinner className="size-4 text-ember-400" /> All tests passed — now measuring how your solution scales…</div>}
            {sub?.complexity && <div className="mt-4"><ComplexityCard report={sub.complexity} /></div>}
          </>
        )}
      </div>
    </div>
  );
}
