import { ArrowLeft, Ban, Printer, BrainCircuit, CameraOff, CheckCircle2, ClipboardPaste, Copy, Eye, EyeOff, Laptop, Maximize, Minimize2, MonitorSmartphone, Send, UserX, Users, XCircle } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import { DECISION, type Decision } from './AssessmentDetail';
import { AccessPanel, type AccessRow, type MediaItem, ProctoringPanel, type SharedWith } from '../components/proctor/ReportPanels';
import { useCallback, useEffect, useState } from 'react';
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
  id: number; title: string; type: 'coding' | 'sql' | 'mcq'; difficulty: 'easy' | 'medium' | 'hard'; points: number; statement: string; score: number; views: number; pool?: string | null;
  options?: { id: string; text: string }[]; correct?: string[]; choice?: string | string[] | null; isCorrect?: boolean;
  language?: string | null; code?: string | null; best?: Submission | null;
  submissions?: { id: number; kind: string; verdict: any; score: number; passed: number; total: number; language: string; createdAt: number; timeMs: number }[];
  snapshots?: Snapshot[];
}
interface Report {
  attempt: { decision: Decision; notes: string; decidedAt: number | null; decidedBy: string | null; id: number; name: string; email: string; status: string; startedAt: number; submittedAt: number | null; deadlineAt: number; score: number; maxScore: number; durationMs: number | null; percentile: number | null; deviceLocked: boolean };
  assessment: { id: number; title: string; durationMin: number; proctoring: { webcam: boolean; identityCheck: boolean; singleDevice: boolean }; retentionDays: number; usesPools: boolean };
  media: MediaItem[];
  access: AccessRow[];
  questions: QReport[];
  events: { id: number; question_id: number | null; type: string; detail: any; t: number }[];
  integrity: {
    score: number; level: string; counts: Record<string, number>; largePastes: number; pastedChars: number; burstEdits: number; flags: string[];
    access: { devices: number; networks: number; sharedWith: SharedWith[] };
  } | null;
  ai: { enabled: boolean; review: any };
  role: 'owner' | 'editor' | 'reviewer';
  flagKeys: string[];
  flagReviews: Record<string, { status: 'explained' | 'concern'; note: string; reviewer: string; updatedAt: number }>;
}

const EVENT_STYLE: Record<string, { icon: any; cls: string; label: string }> = {
  tab_hidden: { icon: EyeOff, cls: 'bg-amber-400', label: 'Left the tab' },
  tab_visible: { icon: Eye, cls: 'bg-ink-500', label: 'Returned' },
  paste: { icon: ClipboardPaste, cls: 'bg-rose-400', label: 'Paste' },
  fullscreen_exit: { icon: Minimize2, cls: 'bg-orange-400', label: 'Exited fullscreen' },
  fullscreen_enter: { icon: Maximize, cls: 'bg-ink-500', label: 'Entered fullscreen' },
  submitted: { icon: Send, cls: 'bg-emerald-400', label: 'Submitted' },
  no_face: { icon: UserX, cls: 'bg-rose-500', label: 'Not on camera' },
  multiple_faces: { icon: Users, cls: 'bg-red-600', label: 'More than one person' },
  camera_lost: { icon: CameraOff, cls: 'bg-rose-400', label: 'Camera disconnected' },
  paste_blocked: { icon: Ban, cls: 'bg-fuchsia-400', label: 'Blocked paste' },
  copy_blocked: { icon: Copy, cls: 'bg-fuchsia-300', label: 'Blocked copy' },
  multi_monitor: { icon: MonitorSmartphone, cls: 'bg-orange-300', label: 'Second display' },
  duplicate_tab: { icon: Copy, cls: 'bg-orange-500', label: 'Second tab' },
  device_change: { icon: Laptop, cls: 'bg-red-400', label: 'Switched device' },
  device_blocked: { icon: Laptop, cls: 'bg-red-300', label: 'Other device refused' },
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
        {Object.keys(EVENT_STYLE).filter((k) => k === 'submitted' || evs.some((e) => e.type === k)).map((k) => <span key={k} className="flex items-center gap-1"><span className={cx('size-2 rounded-full', EVENT_STYLE[k].cls)} />{EVENT_STYLE[k].label}</span>)}
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

function DecisionPanel({ r, onSaved }: { r: Report; onSaved: (d: Decision, notes: string, by: string | null) => void }) {
  const toast = useToast();
  const { user } = useAuth();
  const [notes, setNotes] = useState(r.attempt.notes ?? '');
  const [saving, setSaving] = useState(false);
  const save = async (decision: Decision, n = notes) => {
    setSaving(true);
    try {
      await api.put(`/api/attempts/${r.attempt.id}/review`, { decision, notes: n });
      onSaved(decision, n, decision ? user?.name ?? null : null);
      if (decision === r.attempt.decision) toast.success('Notes saved');
      else toast.success(decision ? `Marked as “${DECISION[decision].label}”` : 'Decision cleared');
    } catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
  };
  const cur = r.attempt.decision;
  return (
    <Card className="no-print p-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="mr-auto font-semibold text-ink-100">Your decision</h2>
        {r.attempt.decidedAt && <span className="text-xs text-ink-500">by {r.attempt.decidedBy} · {new Date(r.attempt.decidedAt).toLocaleDateString()}</span>}
      </div>
      <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label="Decision">
        {(['advance', 'hold', 'reject'] as const).map((d) => (
          <button key={d} role="radio" aria-checked={cur === d} disabled={saving || r.attempt.status !== 'submitted'} onClick={() => save(cur === d ? null : d)}
            className={cx('rounded-lg border px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50', cur === d ? DECISION[d].cls : 'border-ink-700 text-ink-300 hover:border-ink-500 hover:text-ink-100')}>
            {DECISION[d].label}
          </button>
        ))}
      </div>
      {r.attempt.status !== 'submitted' && <p className="mt-2 text-xs text-ink-500">You can decide once the candidate has submitted.</p>}
      <textarea value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => { if (notes !== (r.attempt.notes ?? '')) void save(cur, notes); }} rows={2} placeholder="Private notes for your team (saved when you click away)"
        className="mt-3 w-full rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-sm text-ink-100 placeholder:text-ink-500 focus:border-ember-500/70 focus:outline-none" aria-label="Notes" />
    </Card>
  );
}

/** One integrity flag with its review: explained (with a reason) or a concern. */
function FlagRow({ attemptId, text, flagKey, review, onChange }: { attemptId: number; text: string; flagKey: string; review?: Report['flagReviews'][string]; onChange: () => void }) {
  const toast = useToast();
  const [noting, setNoting] = useState(false);
  const [note, setNote] = useState(review?.note ?? '');
  const save = async (status: 'explained' | 'concern' | null, n = note) => {
    try { await api.put(`/api/attempts/${attemptId}/flags`, { key: flagKey, status, note: n }); setNoting(false); onChange(); }
    catch (e: any) { toast.error(e.message); }
  };
  const st = review?.status;
  return (
    <li className={cx('rounded-lg border px-3 py-2', st === 'explained' ? 'border-emerald-500/25 bg-emerald-500/5' : st === 'concern' ? 'border-rose-500/30 bg-rose-500/5' : 'border-transparent')}>
      <div className="flex flex-wrap items-start gap-2">
        <span className={cx('mt-0.5', st === 'explained' ? 'text-emerald-400' : 'text-amber-400')} aria-hidden="true">{st === 'explained' ? '✓' : '▲'}</span>
        <span className={cx('min-w-0 flex-1 text-sm', st === 'explained' ? 'text-ink-400 line-through decoration-ink-600' : 'text-ink-200')}>{text}</span>
        <div className="no-print flex gap-1">
          <button onClick={() => (st === 'explained' ? save(null) : setNoting(true))} aria-pressed={st === 'explained'} className={cx('rounded-md border px-2 py-0.5 text-[11px]', st === 'explained' ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-300' : 'border-ink-700 text-ink-400 hover:text-ink-100')}>Explained</button>
          <button onClick={() => save(st === 'concern' ? null : 'concern')} aria-pressed={st === 'concern'} className={cx('rounded-md border px-2 py-0.5 text-[11px]', st === 'concern' ? 'border-rose-500/50 bg-rose-500/15 text-rose-300' : 'border-ink-700 text-ink-400 hover:text-ink-100')}>Concern</button>
        </div>
      </div>
      {review && !noting && <div className="mt-1 pl-5 text-xs text-ink-400">{review.status === 'explained' ? 'Explained' : 'Concern'} by {review.reviewer}{review.note ? ` — “${review.note}”` : ''}</div>}
      {noting && (
        <div className="no-print mt-2 flex gap-2 pl-5">
          <input autoFocus value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void save('explained'); if (e.key === 'Escape') setNoting(false); }} placeholder="Why is this fine? (e.g. confirmed network outage)" aria-label="Explanation" className="h-8 min-w-0 flex-1 rounded-md border border-ink-700 bg-ink-900 px-2 text-xs text-ink-100 focus:border-ember-500/60 focus:outline-none" />
          <Button size="sm" onClick={() => save('explained')}>Save</Button>
        </div>
      )}
    </li>
  );
}

const SECTIONS: [string, string][] = [['overview', 'Overview'], ['integrity', 'Integrity'], ['proctoring', 'Proctoring'], ['devices', 'Devices'], ['ai', 'AI review'], ['questions', 'Questions']];

export function CandidateReport() {
  const { id } = useParams();
  const [r, setR] = useState<Report | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => { api.get<Report>(`/api/attempts/${id}`).then(setR).catch((e) => setErr(e.message)); }, [id]);
  useEffect(load, [load]);
  if (err) return <Page><ErrorBox error={err} /></Page>;
  if (!r) return <PageLoader />;
  const a = r.attempt;
  const scorePct = pct(a.score ?? 0, a.maxScore ?? 1);
  const aiByQ = new Map<number, any>((r.ai.review?.questions ?? []).map((x: any) => [x.questionId, x]));
  const hasProctoring = r.media.length > 0 || r.assessment.proctoring.webcam || r.assessment.proctoring.identityCheck;
  const sections = SECTIONS.filter(([k]) => (k === 'proctoring' ? hasProctoring : k === 'devices' || k === 'integrity' ? a.status !== 'invited' : true));
  return (
    <Page>
      <Link to={`/hiring/${r.assessment.id}`} className="no-print mb-4 inline-flex items-center gap-1 text-sm text-ink-400 hover:text-ink-200"><ArrowLeft className="size-4" /> {r.assessment.title}</Link>
      <nav className="no-print sticky top-14 z-20 -mx-4 mb-4 flex items-center gap-1 overflow-x-auto border-b border-ink-800 bg-ink-950/85 px-4 py-2 backdrop-blur" aria-label="Report sections">
        {sections.map(([k, label]) => (
          <a key={k} href={`#${k}`} onClick={(e) => { e.preventDefault(); document.getElementById(k)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }} className="shrink-0 rounded-md px-2.5 py-1 text-xs font-medium text-ink-400 hover:bg-ink-800 hover:text-ink-100">{label}</a>
        ))}
        <Button size="sm" variant="ghost" className="ml-auto shrink-0" onClick={() => window.print()} title="Save as PDF or print"><Printer className="size-3.5" /> Export PDF</Button>
      </nav>
      <div id="overview" className="flex scroll-mt-28 flex-wrap items-center gap-6 rounded-2xl border border-ink-800 bg-ink-900/70 p-6">
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

      <div className="mt-4"><DecisionPanel r={r} onSaved={(decision, notes, by) => setR({ ...r, attempt: { ...r.attempt, decision, notes, decidedAt: decision ? Date.now() : null, decidedBy: by } })} /></div>
      {r.attempt.decision && <div className="mt-2 hidden print:block">Decision: {DECISION[r.attempt.decision].label}{r.attempt.notes ? ` — ${r.attempt.notes}` : ''}</div>}

      {r.integrity && (
        <Card id="integrity" className="mt-4 scroll-mt-28 p-5">
          <div className="mb-3 flex flex-wrap items-baseline gap-2">
            <h2 className="font-semibold text-ink-100">Integrity timeline</h2>
            {r.integrity.flags.length > 0 && (() => {
              const done = r.flagKeys.filter((k) => r.flagReviews[k]).length;
              return <span className={cx('text-xs', done === r.flagKeys.length ? 'text-emerald-300' : 'text-ink-400')}>{done} of {r.flagKeys.length} flags reviewed</span>;
            })()}
          </div>
          <Timeline r={r} />
          <div className="mt-4 grid gap-4 md:grid-cols-[1fr_auto]">
            <ul className="space-y-1.5 text-sm">
              {r.integrity.flags.length ? r.integrity.flags.map((f, i) => <FlagRow key={r.flagKeys[i]} attemptId={a.id} text={f} flagKey={r.flagKeys[i]} review={r.flagReviews[r.flagKeys[i]]} onChange={load} />) : <li className="text-emerald-300">No integrity concerns detected.</li>}
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

      {(r.media.length > 0 || r.assessment.proctoring.webcam || r.assessment.proctoring.identityCheck) && (
        <div id="proctoring" className="mt-4 scroll-mt-28"><ProctoringPanel attemptId={a.id} media={r.media} startedAt={a.startedAt} retentionDays={r.assessment.retentionDays} webcam={r.assessment.proctoring.webcam} onDeleted={load} canDelete={r.role !== 'reviewer'} /></div>
      )}
      {a.status !== 'invited' && (
        <div id="devices" className="mt-4 scroll-mt-28"><AccessPanel attemptId={a.id} access={r.access} sharedWith={r.integrity?.access.sharedWith ?? []} startedAt={a.startedAt} canUnlock={r.role !== 'reviewer' && r.assessment.proctoring.singleDevice && a.status === 'in_progress' && a.deviceLocked} onChanged={load} /></div>
      )}
      <div id="ai" className={cx('mt-4 scroll-mt-28', !r.ai.review && 'no-print')}><AiReview r={r} onReview={(review) => setR({ ...r, ai: { ...r.ai, review } })} /></div>

      <div id="questions" className="mt-4 scroll-mt-28 space-y-4">
        {r.questions.map((q, i) => {
          const ai = aiByQ.get(q.id);
          return (
            <Card key={q.id} className="p-5">
              <div className="mb-3 flex flex-wrap items-center gap-3">
                <span className="text-sm text-ink-500">Q{i + 1}</span>
                <h3 className="font-semibold text-ink-100">{q.title}</h3>
                <Badge>{q.type}</Badge><Difficulty d={q.difficulty} />
                {q.pool && <Badge className="border-ember-500/40 text-ember-200">pool {q.pool}</Badge>}
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
