import { AArrowDown, AArrowUp, Keyboard, Lightbulb, ListTree, Maximize2, Minimize2, Play, RotateCcw, Send, Terminal } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../lib/auth';
import { cx, mem, ms } from '../lib/format';
import type { Problem, Submission } from '../lib/types';
import { isInternalText } from '../lib/proctor';
import { useJudge } from '../lib/useJudge';
import { CodeEditor } from './CodeEditor';
import { Markdown } from './Markdown';
import { ResultsPanel } from './ResultsPanel';
import { SqlTable } from './SqlTable';
import { Badge, Button, Difficulty, Select, Tabs } from './ui';

export interface WorkspaceProps {
  problem: Problem;
  attemptToken?: string;
  /** Submissions count toward this contest. */
  contestSlug?: string;
  /** Initial code + language (e.g. a saved test answer). */
  initial?: { language?: string | null; code?: string | null } | null;
  allowedLanguages?: string[];
  /** Called (debounced by the caller) whenever code or language changes. */
  onChange?: (language: string, code: string) => void;
  onPaste?: (chars: number) => void;
  onCopy?: () => void;
  /** Lockdown (proctored tests). */
  blockExternalPaste?: boolean;
  onBlockedPaste?: () => void;
  blockCopy?: boolean;
  onBlockedCopy?: () => void;
  onJudged?: (s: Submission) => void;
  storageKey?: string;
  headerExtra?: ReactNode;
  sideTabs?: { id: string; label: string; render: () => ReactNode }[];
}

function stored<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}
function store(key: string, v: unknown) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* private mode */ }
}

/** A draggable split, remembered across visits. */
function useResizable(key: string, initial: number, min: number, max: number, axis: 'x' | 'y') {
  const [size, setSize] = useState(() => Math.min(max, Math.max(min, stored(key, initial))));
  const start = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const origin = axis === 'x' ? e.clientX : e.clientY;
    const startSize = size;
    let last = size;
    const move = (ev: PointerEvent) => {
      const d = (axis === 'x' ? ev.clientX : ev.clientY) - origin;
      const total = axis === 'x' ? window.innerWidth : window.innerHeight;
      last = Math.min(max, Math.max(min, startSize + (d / total) * 100 * (axis === 'y' ? -1 : 1)));
      setSize(last);
    };
    const up = () => { store(key, last); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [size, min, max, axis, key]);
  return [size, start] as const;
}

const SHORTCUTS: [string, string][] = [
  ['Ctrl/⌘ + Enter', 'Run on sample tests'],
  ['Ctrl/⌘ + Shift + Enter', 'Submit for judging'],
  ['Ctrl/⌘ + K', 'Search problems & pages'],
  ['Ctrl/⌘ + /', 'Toggle line comment'],
  ['Alt + ↑ / ↓', 'Move line up / down'],
  ['Ctrl/⌘ + F', 'Find in code'],
];

export function Workspace(p: WorkspaceProps) {
  const { meta } = useAuth();
  const isSql = p.problem.type === 'sql';
  const languages = useMemo(() => {
    if (isSql) return [{ id: 'sql', name: 'SQLite', template: '-- Write your query here\nSELECT ' }];
    const all = (meta?.languages ?? []).filter((l) => l.available);
    const allowed = p.allowedLanguages?.length ? p.allowedLanguages : p.problem.languages ?? null;
    return allowed?.length ? all.filter((l) => allowed.includes(l.id)) : all;
  }, [meta, isSql, p.allowedLanguages, p.problem.languages]);

  const storage = p.storageKey ? `crucible:${p.storageKey}` : null;
  const templateFor = useCallback((lang: string) => p.problem.starter?.[lang] ?? languages.find((l) => l.id === lang)?.template ?? '', [languages, p.problem.starter]);

  const [language, setLanguage] = useState<string>(() => {
    if (p.initial?.language) return p.initial.language;
    if (isSql) return 'sql';
    try { return (storage && localStorage.getItem(`${storage}:lang`)) || 'python'; } catch { return 'python'; }
  });
  const [code, setCode] = useState<string>(() => {
    if (p.initial?.code != null) return p.initial.code;
    try { const saved = storage && localStorage.getItem(`${storage}:${language}`); if (saved) return saved; } catch { /* ignore */ }
    return '';
  });
  // Fill the template once languages are known.
  useEffect(() => { if (!code && languages.length) setCode(templateFor(language)); }, [languages.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const changeLanguage = (l: string) => {
    setLanguage(l);
    let next = '';
    try { next = (storage && localStorage.getItem(`${storage}:${l}`)) || ''; } catch { /* ignore */ }
    setCode(next || templateFor(l));
    try { storage && localStorage.setItem(`${storage}:lang`, l); } catch { /* ignore */ }
  };

  const onEdit = (v: string) => {
    setCode(v);
    try { storage && localStorage.setItem(`${storage}:${language}`, v); } catch { /* ignore */ }
  };
  const onChangeRef = useRef(p.onChange);
  onChangeRef.current = p.onChange;
  useEffect(() => { onChangeRef.current?.(language, code); }, [language, code]);

  const judge = useJudge({ attemptToken: p.attemptToken, contestSlug: p.contestSlug, onDone: p.onJudged });
  const [customOn, setCustomOn] = useState(false);
  const [custom, setCustom] = useState(p.problem.samples?.[0]?.input ?? '');
  const [leftTab, setLeftTab] = useState('statement');
  const [split, startSplit] = useResizable('crucible:split', 42, 25, 70, 'x');
  const [consoleH, startConsole] = useResizable('crucible:console', 38, 15, 75, 'y');
  const [consoleTab, setConsoleTab] = useState<'cases' | 'result'>('cases');
  const [caseIdx, setCaseIdx] = useState(0);
  const [focus, setFocus] = useState<boolean>(() => stored('crucible:focus', false));
  const [fontSize, setFontSize] = useState<number>(() => stored('crucible:fontSize', 13.5));
  const [showKeys, setShowKeys] = useState(false);
  const changeFont = (d: number) => setFontSize((f) => { const v = Math.min(22, Math.max(11, f + d)); store('crucible:fontSize', v); return v; });
  const toggleFocus = () => setFocus((f) => { store('crucible:focus', !f); return !f; });

  const run = (kind: 'run' | 'submit') => {
    setConsoleTab('result');
    judge.submit({ questionId: p.problem.id, language, code, kind, customInput: kind === 'run' && customOn && !isSql ? custom : null });
  };

  // Ctrl/Cmd+Enter runs, Ctrl/Cmd+Shift+Enter submits.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !judge.busy) {
        e.preventDefault();
        run(e.shiftKey ? 'submit' : 'run');
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  const lim = p.problem.limits;
  const tabs = [{ id: 'statement', label: 'Problem' }, ...(p.sideTabs ?? []).map((t) => ({ id: t.id, label: t.label }))];
  return (
    <div className="flex h-full min-h-0 flex-col lg:flex-row">
      <section
        className={cx('flex min-h-0 flex-col border-b border-ink-800 lg:basis-[var(--split)] lg:border-r lg:border-b-0', p.blockCopy && 'select-none', focus && 'lg:hidden')}
        style={{ '--split': `${split}%` } as React.CSSProperties}
        aria-label="Problem statement"
        onCopy={p.blockCopy ? (e) => { e.preventDefault(); p.onBlockedCopy?.(); } : undefined}
        onCut={p.blockCopy ? (e) => { e.preventDefault(); p.onBlockedCopy?.(); } : undefined}
        onContextMenu={p.blockCopy ? (e) => e.preventDefault() : undefined}
      >
        <div className="flex items-center gap-2 border-b border-ink-800 px-3 py-2">
          <Tabs tabs={tabs} value={leftTab} onChange={setLeftTab} />
          <div className="ml-auto">{p.headerExtra}</div>
        </div>
        <div className="min-h-0 flex-1 px-5 py-4 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ember-400 lg:overflow-auto" tabIndex={0} role="region" aria-label="Problem details">
          {leftTab === 'statement' ? (
            <>
              <h2 className="text-xl font-semibold text-ink-100">{p.problem.title}</h2>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Difficulty d={p.problem.difficulty} />
                {p.problem.tags.map((t) => <Badge key={t}>{t}</Badge>)}
                {lim && <span className="text-xs text-ink-400">· {ms(lim.timeMs)} · {mem(lim.memoryMb * 1024)}</span>}
                {p.problem.complexity && <Badge className="border-ember-500/40 text-ember-300">target {p.problem.complexity.expected}</Badge>}
              </div>
              <div className="mt-4"><Markdown>{p.problem.statement}</Markdown></div>
              {isSql && p.problem.schema && (
                <div className="mt-4">
                  <div className="mb-1 text-[11px] uppercase tracking-wide text-ink-400">Schema</div>
                  <pre className="overflow-auto rounded-md border border-ink-800 bg-ink-950 p-3 font-mono text-xs text-ink-200">{p.problem.schema}</pre>
                </div>
              )}
              {p.problem.samples?.map((s, i) => (
                <div key={s.id} className="mt-5">
                  <div className="mb-2 text-sm font-semibold text-ink-100">Example {i + 1}</div>
                  {isSql ? (
                    <div className="space-y-2">
                      <pre className="max-h-40 overflow-auto rounded-md border border-ink-800 bg-ink-950 p-3 font-mono text-[11px] text-ink-300">{s.input}</pre>
                      {s.expectedTable && <><div className="text-[11px] uppercase tracking-wide text-ink-400">Expected result</div><SqlTable table={s.expectedTable} /></>}
                    </div>
                  ) : (
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div><div className="mb-1 text-[11px] uppercase tracking-wide text-ink-400">Input</div><pre className="overflow-auto rounded-md border border-ink-800 bg-ink-950 p-3 font-mono text-xs text-ink-200">{s.input}</pre></div>
                      <div><div className="mb-1 text-[11px] uppercase tracking-wide text-ink-400">Output</div><pre className="overflow-auto rounded-md border border-ink-800 bg-ink-950 p-3 font-mono text-xs text-ink-200">{s.expected}</pre></div>
                    </div>
                  )}
                  {s.explanation && <p className="mt-2 text-xs text-ink-400">{s.explanation}</p>}
                </div>
              ))}
            </>
          ) : (
            p.sideTabs?.find((t) => t.id === leftTab)?.render()
          )}
        </div>
      </section>
      <div onPointerDown={startSplit} className={cx('hidden w-1 cursor-col-resize bg-ink-900 transition-colors hover:bg-ember-500/50', !focus && 'lg:block')} role="separator" aria-orientation="vertical" aria-label="Resize panels" />
      <section className="flex min-h-[70vh] min-w-0 flex-1 flex-col lg:min-h-0" aria-label="Code editor">
        <div className="flex flex-wrap items-center gap-2 border-b border-ink-800 px-3 py-2">
          {isSql ? <Badge className="border-sky-500/30 text-sky-300">SQLite</Badge> : (
            <Select value={language} onChange={(e) => changeLanguage(e.target.value)} className="h-8 w-48 py-0 text-xs" aria-label="Language">
              {languages.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
          )}
          <div className="flex items-center rounded-lg border border-ink-800">
            <button onClick={() => { if (confirm('Reset the editor to the starter code?')) onEdit(templateFor(language)); }} title="Reset to starter code" aria-label="Reset to starter code" className="grid size-8 place-items-center text-ink-400 hover:text-ink-100"><RotateCcw className="size-3.5" /></button>
            <button onClick={() => changeFont(-1)} title="Smaller text" aria-label="Smaller text" className="grid size-8 place-items-center border-l border-ink-800 text-ink-400 hover:text-ink-100"><AArrowDown className="size-4" /></button>
            <button onClick={() => changeFont(1)} title="Larger text" aria-label="Larger text" className="grid size-8 place-items-center border-l border-ink-800 text-ink-400 hover:text-ink-100"><AArrowUp className="size-4" /></button>
            <button onClick={toggleFocus} title={focus ? 'Show problem' : 'Focus mode: hide problem'} aria-pressed={focus} aria-label="Focus mode" className={cx('hidden size-8 place-items-center border-l border-ink-800 lg:grid', focus ? 'text-ember-300' : 'text-ink-400 hover:text-ink-100')}>{focus ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}</button>
            <div className="relative border-l border-ink-800">
              <button onClick={() => setShowKeys(!showKeys)} title="Keyboard shortcuts" aria-label="Keyboard shortcuts" aria-expanded={showKeys} className="grid size-8 place-items-center text-ink-400 hover:text-ink-100"><Keyboard className="size-3.5" /></button>
              {showKeys && (
                <div className="absolute top-10 left-0 z-30 w-72 rounded-xl border border-ink-700 bg-ink-900 p-3 shadow-2xl shadow-black/25" onMouseLeave={() => setShowKeys(false)}>
                  <div className="mb-2 text-xs font-medium text-ink-200">Keyboard shortcuts</div>
                  <ul className="space-y-1.5 text-xs">{SHORTCUTS.map(([k, d]) => <li key={k} className="flex items-center justify-between gap-3"><span className="text-ink-400">{d}</span><kbd className="rounded border border-ink-700 bg-ink-850 px-1.5 py-0.5 font-sans text-[10px] text-ink-200">{k}</kbd></li>)}</ul>
                </div>
              )}
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" onClick={() => run('run')} loading={judge.busy && judge.state.kind === 'run'} disabled={judge.busy} title="Run on sample tests (Ctrl+Enter)"><Play className="size-3.5" /> Run</Button>
            <Button size="sm" variant="primary" onClick={() => run('submit')} loading={judge.busy && judge.state.kind === 'submit'} disabled={judge.busy} title="Submit for judging (Ctrl+Shift+Enter)"><Send className="size-3.5" /> Submit</Button>
          </div>
        </div>
        <div className="min-h-[240px] flex-1 overflow-hidden">
          <CodeEditor fontSize={fontSize} value={code} onChange={onEdit} language={language} onPaste={p.onPaste} onCopy={p.onCopy} blockExternalPaste={p.blockExternalPaste} onBlockedPaste={p.onBlockedPaste} />
        </div>
        <div onPointerDown={startConsole} className="hidden h-1 cursor-row-resize bg-ink-900 hover:bg-ember-500/40 lg:block" role="separator" aria-orientation="horizontal" aria-label="Resize console" />
        <div className="flex min-h-[260px] flex-col border-t border-ink-800 bg-ink-900/60 lg:h-[var(--console)] lg:min-h-[200px]" style={{ '--console': `${consoleH}%` } as React.CSSProperties}>
          <div className="flex items-center gap-1 border-b border-ink-800 px-2 py-1.5" role="tablist" aria-label="Console">
            {(['cases', 'result'] as const).map((t) => (
              <button key={t} role="tab" aria-selected={consoleTab === t} onClick={() => setConsoleTab(t)} className={cx('flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium', consoleTab === t ? 'bg-ink-800 text-ink-100' : 'text-ink-400 hover:text-ink-100')}>
                {t === 'cases' ? <><ListTree className="size-3.5" /> Test cases</> : <><Terminal className="size-3.5" /> Result
                  {judge.state.phase !== 'idle' && <span className={cx('size-1.5 rounded-full', judge.busy ? 'animate-ember bg-ember-400' : judge.state.submission?.verdict === 'AC' || judge.state.submission?.verdict === 'OK' ? 'bg-emerald-400' : 'bg-rose-400')} />}</>}
              </button>
            ))}
            {customOn && !isSql && <span className="ml-auto rounded bg-ember-500/10 px-1.5 py-0.5 text-[10px] text-ember-300">custom input on</span>}
          </div>
          <div className="min-h-0 flex-1 overflow-auto" aria-live="polite">
            {consoleTab === 'result' ? <ResultsPanel state={judge.state} /> : (
              <div className="p-3">
                <div className="mb-3 flex flex-wrap gap-1.5">
                  {(p.problem.samples ?? []).map((_, i) => (
                    <button key={i} onClick={() => setCaseIdx(i)} className={cx('rounded-md border px-2.5 py-1 text-xs', caseIdx === i ? 'border-ink-500 bg-ink-800 text-ink-100' : 'border-ink-800 text-ink-400 hover:border-ink-600')}>{isSql ? 'Dataset' : 'Case'} {i + 1}</button>
                  ))}
                  {!isSql && <button onClick={() => setCaseIdx(-1)} className={cx('flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs', caseIdx === -1 ? 'border-ember-500/60 bg-ember-500/10 text-ember-200' : 'border-dashed border-ink-700 text-ink-400 hover:border-ink-500')}><Lightbulb className="size-3" /> Custom</button>}
                </div>
                {caseIdx === -1 && !isSql ? (
                  <div>
                    <label className="mb-2 flex items-center gap-2 text-xs text-ink-300"><input type="checkbox" checked={customOn} onChange={(e) => setCustomOn(e.target.checked)} className="accent-ember-500" /> Include this input when I press Run</label>
                    <textarea value={custom} onChange={(e) => { setCustom(e.target.value); if (!customOn) setCustomOn(true); }} rows={5}
                      onPaste={p.blockExternalPaste ? (e) => { const t = e.clipboardData.getData('text'); if (t && !isInternalText(t)) { e.preventDefault(); p.onBlockedPaste?.(); } } : undefined}
                      className="w-full resize-y rounded-md border border-ink-700 bg-ink-950 px-2.5 py-2 font-mono text-xs text-ink-100 focus:border-ember-500/60 focus:outline-none" aria-label="Custom input" spellCheck={false} />
                  </div>
                ) : p.problem.samples?.[caseIdx] ? (
                  isSql ? (
                    <div className="space-y-2">
                      <pre className="max-h-32 overflow-auto rounded-md border border-ink-800 bg-ink-950 p-2.5 font-mono text-[11px] text-ink-300">{p.problem.samples[caseIdx].input}</pre>
                      {p.problem.samples[caseIdx].expectedTable && <SqlTable table={p.problem.samples[caseIdx].expectedTable!} />}
                    </div>
                  ) : (
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div><div className="mb-1 text-[11px] uppercase tracking-wide text-ink-400">Input</div><pre className="max-h-40 overflow-auto rounded-md border border-ink-800 bg-ink-950 p-2.5 font-mono text-xs text-ink-200">{p.problem.samples[caseIdx].input}</pre></div>
                      <div><div className="mb-1 text-[11px] uppercase tracking-wide text-ink-400">Expected output</div><pre className="max-h-40 overflow-auto rounded-md border border-ink-800 bg-ink-950 p-2.5 font-mono text-xs text-ink-200">{p.problem.samples[caseIdx].expected}</pre></div>
                    </div>
                  )
                ) : <p className="text-xs text-ink-400">No sample cases.</p>}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
