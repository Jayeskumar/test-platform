import { ArrowLeft, BrainCircuit, CheckCircle2, ClipboardPaste, Eye, EyeOff, Maximize, Minimize2, Send, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ComplexityCard, ScoreRing } from '../components/charts';
import { CodeEditor } from '../components/CodeEditor';
import { Page } from '../components/Layout';
import { Markdown } from '../components/Markdown';
import { Playback, type Snapshot } from '../components/Playback';
import { Badge, Button, Card, Difficulty, ErrorBox, PageLoader, Tabs, VerdictBadge } from '../components/ui';
import { api } from '../lib/api';
import { cx, duration, mem, ms, pct } from '../lib/format';
import type { Submission } from '../lib/types';
import { INTEGRITY_CLS } from './AssessmentDetail';

interface QReport {
  id: number; title: string; type: 'coding' | 'sql' | 'mcq'; difficulty: 'easy' | 'medium' | 'hard'; points: number; statement: string; score: number; views: number;
  options?: { id: string; text: string }[]; correct?: string[]; choice?: string | string[] | null; isCorrect?: boolean;
  language?: string | null; code?: string | null; best?: Submission | null;
  submissions?: { id: number; kind: string; verdict: any; score: number; passed: number; total: number; language: string; createdAt: number; timeMs: number }[];
  snapshots?: Snapshot[];
}
interface Report {
  attempt: { id: number; name: string; email: string; status: string; startedAt: number; submittedAt: number | null; deadlineAt: number; score: number; maxScore: number; durationMs: number | null; percentile: number | null };
  assessment: { id: number; title: string; durationMin: number };
  questions: QReport[];
  events: { id: number; question_id: number | null; type: string; detail: any; t: number }[];
  integrity: { score: number; level: string; counts: Record<string, number>; largePastes: number; pastedChars: number; burstEdits: number; flags: string[] } | null;
  ai: { enabled: boolean; review: any };
}

const EVENT_STYLE: Record<string, { icon: any; cls: string; label: string }> = {
  tab_hidden: { icon: EyeOff, cls: 'bg-amber-400', label: 'Left the tab' },
  tab_visible: { icon: Eye, cls: 'bg-ink-500', label: 'Returned' },
  paste: { icon: ClipboardPaste, cls: 'bg-rose-400', label: 'Paste' },
  fullscreen_exit: { icon: Minimize2, cls: 'bg-orange-400', label: 'Exited fullscreen' },
  fullscreen_enter: { icon: Maximize, cls: 'bg-ink-500', label: 'Entered fullscreen' },
  submitted: { icon: Send, cls: 'bg-emerald-400', label: 'Submitted' },
};

function Timeline({ r }: { r: Report }) {
  const start = r.attempt.startedAt;
  const end = r.attempt.submittedAt ?? r.attempt.deadlineAt;
  const span = Math.max(1, end - start);
  const evs = r.events.filter((e) => EVENT_STYLE[e.type] && e.type !== 'tab_visible' && e.type !== 'fullscreen_enter');
  return (
    <div>
      <div className="relative h-8">
        <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-ink-800" />
        {evs.map((e) => (
          <span key={e.id} className={cx('absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-ink-900', EVENT_STYLE[e.type].cls)} style={{ left: `${Math.min(100, ((e.t - start) / span) * 100)}%` }} title={`T+${duration(e.t - start)} — ${EVENT_STYLE[e.type].label}${e.detail?.chars ? ` (${e.detail.chars} chars)` : ''}`} />
        ))}
      </div>
      <div className="flex justify-between text-[11px] text-ink-500"><span>start</span><span>{duration(span)}</span></div>
      <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-ink-400">
        {['tab_hidden', 'paste', 'fullscreen_exit', 'submitted'].map((k) => <span key={k} className="flex items-center gap-1"><span className={cx('size-2 rounded-full', EVENT_STYLE[k].cls)} />{EVENT_STYLE[k].label}</span>)}
      </div>
    </div>
  );
}

function CodingQuestion({ q, r }: { q: QReport; r: Report }) {
  const [tab, setTab] = useState<'code' | 'playback' | 'tests' | 'history'>('code');
  const best = q.best;
  const pastes = r.events.filter((e) => e.type === 'paste' && e.question_id === q.id).map((e) => e.t);
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Tabs value={tab} onChange={setTab} tabs={[{ id: 'code', label: 'Final code' }, { id: 'playback', label: `Playback (${q.snapshots?.length ?? 0})` }, { id: 'tests', label: 'Test results' }, { id: 'history', label: `Submissions (${q.submissions?.length ?? 0})` }]} />
        {best && <span className="ml-auto flex items-center gap-2 text-xs text-ink-400"><VerdictBadge verdict={best.verdict} long /> {best.passed}/{best.total} tests · {ms(best.timeMs)} · {mem(best.memoryKb)} · {best.language}</span>}
      </div>
      {tab === 'code' && (q.code ? <div className="h-80 overflow-hidden rounded-lg border border-ink-800"><CodeEditor value={q.code} language={q.language ?? 'python'} readOnly /></div> : <p className="text-sm text-ink-400">No code written.</p>)}
      {tab === 'playback' && <Playback snapshots={q.snapshots ?? []} startedAt={r.attempt.startedAt} pastes={pastes} />}
      {tab === 'tests' && (best ? (
        <div className="overflow-hidden rounded-lg border border-ink-800">
          <table className="w-full text-xs">
            <thead className="bg-ink-850 text-left text-ink-400"><tr><th className="px-3 py-2 font-medium">Test</th><th className="px-3 py-2 font-medium">Verdict</th><th className="px-3 py-2 font-medium">CPU</th><th className="px-3 py-2 font-medium">Memory</th><th className="px-3 py-2 font-medium">Details</th></tr></thead>
            <tbody>
              {best.results.map((t) => (
                <tr key={t.index} className="border-t border-ink-800 align-top">
                  <td className="px-3 py-2 text-ink-300">{t.index + 1}{t.sample && <span className="ml-1 text-ink-500">(sample)</span>}</td>
                  <td className="px-3 py-2"><VerdictBadge verdict={t.verdict} /></td>
                  <td className="px-3 py-2 tabular-nums text-ink-300">{ms(t.timeMs)}</td>
                  <td className="px-3 py-2 tabular-nums text-ink-300">{mem(t.memoryKb)}</td>
                  <td className="px-3 py-2 text-ink-400">{t.message ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {best.compileOutput && best.verdict === 'CE' && <pre className="border-t border-ink-800 p-3 font-mono text-xs whitespace-pre-wrap text-sky-200">{best.compileOutput}</pre>}
        </div>
      ) : <p className="text-sm text-ink-400">Not judged.</p>)}
      {tab === 'history' && (
        <ul className="divide-y divide-ink-800 rounded-lg border border-ink-800">
          {(q.submissions ?? []).map((s) => (
            <li key={s.id} className="flex items-center gap-3 px-3 py-2 text-xs">
              <Badge>{s.kind}</Badge><VerdictBadge verdict={s.verdict} /><span className="text-ink-300">{s.language}</span>
              <span className="text-ink-400">{s.passed}/{s.total}</span>
              <span className="ml-auto font-mono text-ink-500">T+{duration(s.createdAt - r.attempt.startedAt)}</span>
            </li>
          ))}
          {!q.submissions?.length && <li className="px-3 py-2 text-xs text-ink-400">No runs or submissions.</li>}
        </ul>
      )}
      {best?.complexity && <div className="mt-3"><ComplexityCard report={best.complexity} /></div>}
    </div>
  );
}

function McqQuestion({ q }: { q: QReport }) {
  const picked = Array.isArray(q.choice) ? q.choice : q.choice ? [q.choice] : [];
  return (
    <ul className="space-y-1.5">
      {q.options?.map((o) => {
        const isPicked = picked.includes(o.id);
        const isRight = q.correct?.includes(o.id);
        return (
          <li key={o.id} className={cx('flex items-start gap-2 rounded-md border px-3 py-2 text-sm', isRight ? 'border-emerald-500/30 bg-emerald-500/5' : isPicked ? 'border-rose-500/30 bg-rose-500/5' : 'border-ink-800')}>
            {isPicked ? (isRight ? <CheckCircle2 className="mt-0.5 size-4 text-emerald-400" /> : <XCircle className="mt-0.5 size-4 text-rose-400" />) : <span className="mt-0.5 size-4" />}
            <div className="prose-crucible flex-1 [&_p]:m-0"><Markdown>{o.text}</Markdown></div>
            {isRight && <span className="text-[11px] text-emerald-300">correct</span>}
          </li>
        );
      })}
      {!picked.length && <li className="text-xs text-ink-400">Not answered.</li>}
    </ul>
  );
}

function AiReview({ r, onReview }: { r: Report; onReview: (v: any) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const review = r.ai.review;
  const gen = async () => {
    setBusy(true);
    setErr(null);
    try { onReview((await api.post<{ review: any }>(`/api/attempts/${r.attempt.id}/ai-review`)).review); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const rec: Record<string, string> = { strong_yes: 'Strong yes', yes: 'Yes', lean_no: 'Lean no', no: 'No' };
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2">
        <BrainCircuit className="size-5 text-ember-400" /><h2 className="font-semibold text-ink-100">AI code review</h2>
        {review && <Badge className="border-ember-500/40 text-ember-200">{rec[review.recommendation] ?? review.recommendation}</Badge>}
        <div className="ml-auto">{r.ai.enabled && r.attempt.status === 'submitted' && <Button size="sm" onClick={gen} loading={busy}>{review ? 'Regenerate' : 'Generate review'}</Button>}</div>
      </div>
      {!r.ai.enabled && <p className="mt-2 text-sm text-ink-400">Set <code className="text-ink-300">ANTHROPIC_API_KEY</code> on the server to have Claude review each submission’s correctness, efficiency and code quality and suggest follow-up interview questions.</p>}
      <div className="mt-2"><ErrorBox error={err} /></div>
      {review && (
        <div className="mt-3 space-y-4 text-sm">
          <p className="text-ink-200">{review.summary}</p>
          <div className="grid gap-4 md:grid-cols-2">
            <div><div className="mb-1 text-xs font-medium uppercase tracking-wide text-emerald-300">Strengths</div><ul className="list-disc space-y-1 pl-5 text-ink-300">{review.strengths.map((s: string, i: number) => <li key={i}>{s}</li>)}</ul></div>
            <div><div className="mb-1 text-xs font-medium uppercase tracking-wide text-rose-300">Concerns</div><ul className="list-disc space-y-1 pl-5 text-ink-300">{review.concerns.map((s: string, i: number) => <li key={i}>{s}</li>)}</ul></div>
          </div>
          <div><div className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-400">Ask in the next round</div><ol className="list-decimal space-y-1 pl-5 text-ink-300">{review.followUpQuestions.map((s: string, i: number) => <li key={i}>{s}</li>)}</ol></div>
        </div>
      )}
    </Card>
  );
}

export function CandidateReport() {
  const { id } = useParams();
  const [r, setR] = useState<Report | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api.get<Report>(`/api/attempts/${id}`).then(setR).catch((e) => setErr(e.message)); }, [id]);
  if (err) return <Page><ErrorBox error={err} /></Page>;
  if (!r) return <PageLoader />;
  const a = r.attempt;
  const scorePct = pct(a.score ?? 0, a.maxScore ?? 1);
  const aiByQ = new Map<number, any>((r.ai.review?.questions ?? []).map((x: any) => [x.questionId, x]));
  return (
    <Page>
      <Link to={`/hiring/${r.assessment.id}`} className="mb-4 inline-flex items-center gap-1 text-sm text-ink-400 hover:text-ink-200"><ArrowLeft className="size-4" /> {r.assessment.title}</Link>
      <div className="flex flex-wrap items-center gap-6 rounded-2xl border border-ink-800 bg-ink-900/70 p-6">
        <ScoreRing value={scorePct} size={96} label="Score" />
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold text-ink-100">{a.name || a.email}</h1>
          <div className="text-sm text-ink-400">{a.email}</div>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-ink-300">
            <span><span className="text-ink-500">Score</span> {a.score ?? 0}/{a.maxScore ?? '—'}</span>
            {a.percentile != null && <span><span className="text-ink-500">Percentile</span> {a.percentile}</span>}
            {a.durationMs != null && <span><span className="text-ink-500">Time used</span> {duration(a.durationMs)} of {r.assessment.durationMin}:00</span>}
            <span className="capitalize"><span className="text-ink-500">Status</span> {a.status.replace('_', ' ')}</span>
          </div>
        </div>
        {r.integrity && (
          <div className="text-center">
            <div className={cx('rounded-xl border px-4 py-2', INTEGRITY_CLS[r.integrity.level])}>
              <div className="text-2xl font-semibold tabular-nums">{r.integrity.score}</div>
              <div className="text-[11px] uppercase tracking-wide">integrity · {r.integrity.level}</div>
            </div>
          </div>
        )}
      </div>

      {r.integrity && (
        <Card className="mt-4 p-5">
          <h2 className="mb-3 font-semibold text-ink-100">Integrity timeline</h2>
          <Timeline r={r} />
          <div className="mt-4 grid gap-4 md:grid-cols-[1fr_auto]">
            <ul className="space-y-1.5 text-sm">
              {r.integrity.flags.length ? r.integrity.flags.map((f, i) => <li key={i} className="flex gap-2 text-ink-200"><span className="text-amber-400">▲</span>{f}</li>) : <li className="text-emerald-300">No integrity concerns detected.</li>}
            </ul>
            <div className="grid h-fit grid-cols-3 gap-2 text-center text-xs">
              {[['Tab switches', r.integrity.counts.tab_hidden ?? 0], ['Pastes', r.integrity.counts.paste ?? 0], ['Fullscreen exits', r.integrity.counts.fullscreen_exit ?? 0]].map(([l, v]) => (
                <div key={l as string} className="rounded-lg bg-ink-850 px-3 py-2"><div className="text-lg font-semibold tabular-nums text-ink-100">{v}</div><div className="text-ink-400">{l}</div></div>
              ))}
            </div>
          </div>
          <p className="mt-3 text-xs text-ink-500">Signals are evidence for a conversation, not a verdict. Similarity matches weigh how the code arrived — pasted or typed — when deciding who is penalized.</p>
        </Card>
      )}

      <div className="mt-4"><AiReview r={r} onReview={(review) => setR({ ...r, ai: { ...r.ai, review } })} /></div>

      <div className="mt-4 space-y-4">
        {r.questions.map((q, i) => {
          const ai = aiByQ.get(q.id);
          return (
            <Card key={q.id} className="p-5">
              <div className="mb-3 flex flex-wrap items-center gap-3">
                <span className="text-sm text-ink-500">Q{i + 1}</span>
                <h3 className="font-semibold text-ink-100">{q.title}</h3>
                <Badge>{q.type}</Badge><Difficulty d={q.difficulty} />
                <span className={cx('ml-auto text-sm font-semibold tabular-nums', q.score >= q.points ? 'text-emerald-300' : q.score > 0 ? 'text-amber-300' : 'text-rose-300')}>{Math.round(q.score * 100) / 100}/{q.points}</span>
              </div>
              <details className="mb-3 text-sm"><summary className="cursor-pointer text-xs text-ink-400 hover:text-ink-200">Show question</summary><div className="mt-2 rounded-lg border border-ink-800 p-3"><Markdown>{q.statement}</Markdown></div></details>
              {q.type === 'mcq' ? <McqQuestion q={q} /> : <CodingQuestion q={q} r={r} />}
              {ai && (
                <div className="mt-3 rounded-lg border border-ember-500/20 bg-ember-500/5 p-3 text-sm">
                  <div className="mb-1 flex flex-wrap gap-3 text-xs text-ink-400">
                    <span>Correctness: <b className="text-ink-200">{ai.correctness}</b></span><span>Efficiency: <b className="text-ink-200">{ai.efficiency}</b></span><span>Quality: <b className="text-ink-200">{ai.codeQuality}</b></span>
                  </div>
                  <p className="text-ink-300">{ai.notes}</p>
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </Page>
  );
}
