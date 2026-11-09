import { AlertTriangle, CheckCircle2, Clock, Code2, Database, Eye, ListChecks, Maximize, Send } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Logo } from '../components/Layout';
import { Markdown } from '../components/Markdown';
import { Button, Card, Difficulty, ErrorBox, Input, Label, PageLoader } from '../components/ui';
import { Workspace } from '../components/Workspace';
import { api } from '../lib/api';
import { cx, duration } from '../lib/format';
import type { Problem } from '../lib/types';

type TQ = Problem & { points: number; answer: { language: string | null; code: string | null; choice: any } | null };
interface TakeData {
  attempt: { status: 'invited' | 'in_progress' | 'submitted'; candidateName: string; candidateEmail: string; deadlineAt: number | null; serverNow: number; score?: number; maxScore?: number };
  assessment: { title: string; description: string; durationMin: number; status: string; questionCount: number; totalPoints: number; breakdown: { coding: number; sql: number; mcq: number }; settings: { languages: string[]; proctoring: { trackTabs: boolean; requireFullscreen: boolean; detectPaste: boolean; recordPlayback: boolean } } };
  questions?: TQ[];
}
interface Ev { type: string; questionId?: number | null; detail?: Record<string, unknown>; t: number }

function Intro({ data, token, onStarted }: { data: TakeData; token: string; onStarted: () => void }) {
  const [name, setName] = useState(data.attempt.candidateName);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const a = data.assessment;
  const p = a.settings.proctoring;
  const start = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api.post(`/api/take/${token}/start`, { name });
      if (p.requireFullscreen) { try { await document.documentElement.requestFullscreen(); } catch { /* user can decline */ } }
      onStarted();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <Logo className="mb-8" />
      <h1 className="text-3xl font-semibold tracking-tight text-ink-100">{a.title}</h1>
      <div className="mt-2 flex flex-wrap gap-4 text-sm text-ink-300">
        <span className="flex items-center gap-1.5"><Clock className="size-4 text-ember-400" />{a.durationMin} minutes</span>
        {a.breakdown.coding > 0 && <span className="flex items-center gap-1.5"><Code2 className="size-4 text-ink-400" />{a.breakdown.coding} coding</span>}
        {a.breakdown.sql > 0 && <span className="flex items-center gap-1.5"><Database className="size-4 text-ink-400" />{a.breakdown.sql} SQL</span>}
        {a.breakdown.mcq > 0 && <span className="flex items-center gap-1.5"><ListChecks className="size-4 text-ink-400" />{a.breakdown.mcq} multiple choice</span>}
      </div>
      {a.description && <div className="mt-6"><Markdown>{a.description}</Markdown></div>}
      <Card className="mt-6 p-5">
        <h2 className="mb-2 font-semibold text-ink-100">Before you start</h2>
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-ink-300">
          <li>The timer starts when you click <b>Start</b> and does not pause. When it runs out, your work is submitted automatically.</li>
          <li>Your answers save automatically. You can <b>Run</b> code against the sample tests and <b>Submit</b> a coding answer as many times as you like; your best submission counts.</li>
          <li>Coding answers are judged on hidden tests too, and some are also checked for how the running time scales with input size.</li>
        </ul>
        <h3 className="mt-4 mb-2 flex items-center gap-2 text-sm font-semibold text-ink-100"><Eye className="size-4 text-ember-400" /> What this test records</h3>
        <ul className="list-disc space-y-1 pl-5 text-sm text-ink-300">
          {p.recordPlayback && <li>Periodic snapshots of your code, so the hiring team can replay how you wrote it.</li>}
          {p.trackTabs && <li>When you switch away from this tab or window.</li>}
          {p.detectPaste && <li>When you paste into the editor, and how many characters.</li>}
          {p.requireFullscreen && <li>When you leave fullscreen mode.</li>}
          <li>Your code is compared with other submissions for similarity.</li>
        </ul>
        <p className="mt-2 text-xs text-ink-500">No camera, microphone or screen recording is used.</p>
      </Card>
      <div className="mt-6 space-y-4">
        <div><Label>Your full name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="As you'd like the hiring team to see it" /></div>
        <label className="flex items-start gap-2 text-sm text-ink-300"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-1 accent-ember-500" /> I understand what is recorded and will complete this test on my own.</label>
        <ErrorBox error={err} />
        <Button variant="primary" size="lg" onClick={start} loading={busy} disabled={!name.trim() || !agree || a.status !== 'active'}>Start the test</Button>
        {a.status !== 'active' && <p className="text-sm text-amber-300">This assessment isn’t accepting candidates right now.</p>}
      </div>
    </div>
  );
}

function Done({ data }: { data: TakeData }) {
  return (
    <div className="flex min-h-full items-center justify-center px-4">
      <div className="max-w-md text-center">
        <CheckCircle2 className="mx-auto size-12 text-emerald-400" />
        <h1 className="mt-4 text-2xl font-semibold text-ink-100">Submitted — thank you!</h1>
        <p className="mt-2 text-ink-300">Your answers for <b>{data.assessment.title}</b> are in. The hiring team will be in touch.</p>
        {data.attempt.score != null && <p className="mt-4 text-lg text-ink-100">Your score: <b>{data.attempt.score}</b> / {data.attempt.maxScore}</p>}
        <p className="mt-6 text-xs text-ink-500">You can close this window.</p>
      </div>
    </div>
  );
}

function Mcq({ q, onAnswer }: { q: TQ; onAnswer: (choice: string | string[]) => void }) {
  const initial = q.answer?.choice;
  const [choice, setChoice] = useState<string[]>(Array.isArray(initial) ? initial : initial ? [initial] : []);
  const toggle = (id: string) => {
    const next = q.multiple ? (choice.includes(id) ? choice.filter((x) => x !== id) : [...choice, id]) : [id];
    setChoice(next);
    onAnswer(q.multiple ? next : next[0]);
  };
  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <div className="mb-1 flex items-center gap-3"><h2 className="text-xl font-semibold text-ink-100">{q.title}</h2><Difficulty d={q.difficulty} /><span className="text-xs text-ink-400">{q.points} points</span></div>
      <div className="mt-3"><Markdown>{q.statement}</Markdown></div>
      {q.multiple && <p className="mt-2 text-xs text-ink-400">Select all that apply.</p>}
      <div className="mt-4 space-y-2" role={q.multiple ? 'group' : 'radiogroup'}>
        {q.options!.map((o) => (
          <button key={o.id} role={q.multiple ? 'checkbox' : 'radio'} aria-checked={choice.includes(o.id)} onClick={() => toggle(o.id)} className={cx('flex w-full items-start gap-3 rounded-lg border px-4 py-3 text-left text-sm transition-colors', choice.includes(o.id) ? 'border-ember-500/60 bg-ember-500/10' : 'border-ink-800 hover:border-ink-600')}>
            <span className={cx('mt-0.5 grid size-4 shrink-0 place-items-center border', q.multiple ? 'rounded' : 'rounded-full', choice.includes(o.id) ? 'border-ember-400 bg-ember-500' : 'border-ink-500')} />
            <span className="prose-crucible flex-1 [&_p]:m-0"><Markdown>{o.text}</Markdown></span>
          </button>
        ))}
      </div>
      <p className="mt-3 text-xs text-ink-500">Saved automatically.</p>
    </div>
  );
}

function Test({ data, token, onSubmitted }: { data: TakeData; token: string; onSubmitted: () => void }) {
  const qs = data.questions!;
  const [cur, setCur] = useState(0);
  const offset = useMemo(() => data.attempt.serverNow - Date.now(), [data.attempt.serverNow]);
  const [left, setLeft] = useState((data.attempt.deadlineAt ?? 0) - (Date.now() + offset));
  const [answered, setAnswered] = useState<Set<number>>(() => new Set(qs.filter((q) => q.answer && (q.answer.choice != null || (q.answer.code ?? '').trim())).map((q) => q.id)));
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [fsWarn, setFsWarn] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const answers = useRef(new Map<number, { language: string | null; code: string | null }>(qs.map((q) => [q.id, { language: q.answer?.language ?? null, code: q.answer?.code ?? null }])));
  const queue = useRef<Ev[]>([]);
  const pending = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const p = data.assessment.settings.proctoring;
  const q = qs[cur];

  const log = useCallback((type: string, detail?: Record<string, unknown>, questionId?: number | null) => {
    queue.current.push({ type, detail, questionId: questionId ?? null, t: Date.now() + offset });
  }, [offset]);
  const flush = useCallback(async () => {
    if (!queue.current.length) return;
    const events = queue.current.splice(0, 200);
    try { await api.post(`/api/take/${token}/events`, { events }); } catch { queue.current.unshift(...events); }
  }, [token]);

  const saveCode = useCallback(async (qid: number) => {
    pending.current.delete(qid);
    const a = answers.current.get(qid);
    if (!a) return;
    try { const r = await api.put<{ savedAt: number }>(`/api/take/${token}/answers/${qid}`, { language: a.language, code: a.code ?? '' }); setSavedAt(r.savedAt); setErr(null); }
    catch (e: any) { if (e.status === 410) onSubmitted(); else setErr('Could not save — check your connection. We will keep retrying.'); }
  }, [token, onSubmitted]);

  const finish = useCallback(async () => {
    setSubmitting(true);
    for (const qid of [...pending.current.keys()]) { clearTimeout(pending.current.get(qid)); await saveCode(qid); }
    await flush();
    try { await api.post(`/api/take/${token}/submit`); } catch { /* already submitted or timed out */ }
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    onSubmitted();
  }, [flush, saveCode, token, onSubmitted]);

  // Timer + auto-submit.
  useEffect(() => {
    const id = setInterval(() => {
      const l = (data.attempt.deadlineAt ?? 0) - (Date.now() + offset);
      setLeft(l);
      if (l <= 0) { clearInterval(id); void finish(); }
    }, 500);
    return () => clearInterval(id);
  }, [data.attempt.deadlineAt, offset, finish]);

  // Proctoring signals.
  useEffect(() => {
    const vis = () => { if (p.trackTabs) log(document.hidden ? 'tab_hidden' : 'tab_visible'); };
    const fs = () => {
      if (!p.requireFullscreen) return;
      const on = !!document.fullscreenElement;
      log(on ? 'fullscreen_enter' : 'fullscreen_exit');
      setFsWarn(!on);
    };
    document.addEventListener('visibilitychange', vis);
    document.addEventListener('fullscreenchange', fs);
    if (p.requireFullscreen && !document.fullscreenElement) setFsWarn(true);
    const id = setInterval(flush, 5000);
    const unload = () => { if (queue.current.length) navigator.sendBeacon?.(`/api/take/${token}/events`, new Blob([JSON.stringify({ events: queue.current })], { type: 'application/json' })); };
    window.addEventListener('beforeunload', unload);
    return () => { document.removeEventListener('visibilitychange', vis); document.removeEventListener('fullscreenchange', fs); clearInterval(id); window.removeEventListener('beforeunload', unload); };
  }, [p.trackTabs, p.requireFullscreen, log, flush, token]);

  useEffect(() => { log('question_view', {}, q.id); }, [q.id, log]);

  const onCodeChange = useCallback((qid: number) => (language: string, code: string) => {
    const prev = answers.current.get(qid);
    if (prev && prev.code === code && prev.language === language) return;
    answers.current.set(qid, { language, code });
    setAnswered((s) => { const n = new Set(s); if (code.trim()) n.add(qid); else n.delete(qid); return n; });
    // Throttle: save at most every 2 seconds per question (also feeds code playback).
    if (!pending.current.has(qid)) pending.current.set(qid, setTimeout(() => void saveCode(qid), 2000));
  }, [saveCode]);
  const changeHandlers = useMemo(() => new Map(qs.map((x) => [x.id, onCodeChange(x.id)])), [qs, onCodeChange]);

  const answerMcq = async (choice: string | string[]) => {
    setAnswered((s) => new Set(s).add(q.id));
    try { const r = await api.put<{ savedAt: number }>(`/api/take/${token}/answers/${q.id}`, { choice }); setSavedAt(r.savedAt); } catch (e: any) { if (e.status === 410) onSubmitted(); }
  };

  const low = left < 5 * 60_000;
  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-ink-800 bg-ink-950 px-4">
        <Logo className="hidden sm:flex" />
        <span className="hidden truncate text-sm text-ink-300 md:inline">{data.assessment.title}</span>
        <nav className="mx-auto flex items-center gap-1 overflow-x-auto" aria-label="Questions">
          {qs.map((x, i) => (
            <button key={x.id} onClick={() => setCur(i)} aria-current={i === cur} title={`${x.title} (${x.points} pts)`} className={cx('grid size-8 shrink-0 place-items-center rounded-lg border text-xs font-medium', i === cur ? 'border-ember-500 bg-ember-500/15 text-ember-200' : answered.has(x.id) ? 'border-emerald-500/40 text-emerald-300' : 'border-ink-700 text-ink-400 hover:border-ink-500')}>{i + 1}</button>
          ))}
        </nav>
        <span className="hidden text-xs text-ink-500 lg:inline">{savedAt ? `saved ${new Date(savedAt).toLocaleTimeString()}` : 'autosave on'}</span>
        <div className={cx('flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-mono text-sm tabular-nums', low ? 'animate-ember bg-rose-500/15 text-rose-300' : 'bg-ink-800 text-ink-100')} role="timer" aria-label="Time remaining"><Clock className="size-4" />{duration(left)}</div>
        <Button variant="primary" size="sm" onClick={() => setConfirming(true)}><Send className="size-3.5" /> Finish</Button>
      </header>
      {err && <div className="bg-amber-500/10 px-4 py-1.5 text-center text-xs text-amber-200">{err}</div>}
      {fsWarn && (
        <div className="flex items-center justify-center gap-3 bg-amber-500/10 px-4 py-1.5 text-xs text-amber-200">
          <AlertTriangle className="size-3.5" /> This test asks you to stay in fullscreen.
          <button onClick={() => document.documentElement.requestFullscreen().catch(() => {})} className="flex items-center gap-1 underline"><Maximize className="size-3.5" /> Return to fullscreen</button>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        {q.type === 'mcq' ? <Mcq key={q.id} q={q} onAnswer={answerMcq} /> : (
          <Workspace
            key={q.id}
            problem={q}
            attemptToken={token}
            initial={answers.current.get(q.id)}
            allowedLanguages={data.assessment.settings.languages}
            onChange={changeHandlers.get(q.id)}
            onPaste={p.detectPaste ? (chars) => log('paste', { chars }, q.id) : undefined}
            onCopy={p.detectPaste ? () => log('copy', {}, q.id) : undefined}
            headerExtra={<span className="text-xs text-ink-400">{q.points} points</span>}
          />
        )}
      </div>
      {confirming && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink-950/80 px-4" role="dialog" aria-modal="true" aria-labelledby="finish-title">
          <Card className="w-full max-w-md p-6">
            <h2 id="finish-title" className="text-lg font-semibold text-ink-100">Finish the test?</h2>
            <p className="mt-2 text-sm text-ink-300">You’ve answered {answered.size} of {qs.length} questions. Code you wrote but didn’t submit will be judged automatically. You can’t make changes afterwards.</p>
            <div className="mt-5 flex justify-end gap-2">
              <Button onClick={() => setConfirming(false)}>Keep working</Button>
              <Button variant="primary" onClick={finish} loading={submitting}>Submit test</Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

export function TakeTest() {
  const { token = '' } = useParams();
  const [data, setData] = useState<TakeData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => api.get<TakeData>(`/api/take/${token}`).then(setData).catch((e) => setErr(e.message)), [token]);
  useEffect(() => { void load(); }, [load]);
  if (err) return <div className="mx-auto max-w-md px-4 py-24"><Logo className="mb-6" /><ErrorBox error={err} /></div>;
  if (!data) return <PageLoader />;
  if (data.attempt.status === 'invited') return <Intro data={data} token={token} onStarted={load} />;
  if (data.attempt.status === 'submitted') return <Done data={data} />;
  return <div className="h-screen"><Test data={data} token={token} onSubmitted={load} /></div>;
}
