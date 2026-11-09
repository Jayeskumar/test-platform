import { ArrowDown, ArrowUp, Plus, Search, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Page, PageHeader } from '../components/Layout';
import { Badge, Button, Card, Difficulty, ErrorBox, Input, Label, PageLoader, Select, Textarea, Toggle } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { cx } from '../lib/format';

interface LibQ { id: number; title: string; type: 'coding' | 'sql' | 'mcq'; difficulty: 'easy' | 'medium' | 'hard'; tags: string[]; visibility: string }
const DEFAULT_POINTS = { coding: 100, sql: 100, mcq: 20 };

export function AssessmentEditor() {
  const { id } = useParams();
  const nav = useNavigate();
  const { meta } = useAuth();
  const [lib, setLib] = useState<LibQ[] | null>(null);
  const [form, setForm] = useState({
    title: '', description: '', durationMin: 60, status: 'active',
    settings: {
      languages: [] as string[],
      proctoring: {
        trackTabs: true, requireFullscreen: false, detectPaste: true, recordPlayback: true,
        webcam: false, webcamIntervalSec: 45, identityCheck: false,
        blockExternalPaste: false, blockCopy: false, detectMultiMonitor: true, singleDevice: false,
      },
      showScoreToCandidate: false, shuffleQuestions: false,
      pools: {} as Record<string, { draw: number }>,
      retentionDays: 90,
    },
    questions: [] as { questionId: number; points: number; pool: string | null }[],
  });
  const [q, setQ] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get<{ questions: LibQ[] }>('/api/library/questions').then((r) => setLib(r.questions)).catch((e) => setErr(e.message));
    if (id) {
      api.get<any>(`/api/assessments/${id}`).then((r) => setForm({
        title: r.assessment.title, description: r.assessment.description, durationMin: r.assessment.durationMin, status: r.assessment.status,
        settings: r.assessment.settings, questions: r.questions.map((x: any) => ({ questionId: x.id, points: x.points, pool: x.pool ?? null })),
      })).catch((e) => setErr(e.message));
    }
  }, [id]);

  const byId = useMemo(() => new Map((lib ?? []).map((x) => [x.id, x])), [lib]);
  const available = (lib ?? []).filter((x) => !form.questions.some((s) => s.questionId === x.id) && (!q || x.title.toLowerCase().includes(q.toLowerCase())) && (!typeFilter || x.type === typeFilter));
  const total = form.questions.reduce((s, x) => s + x.points, 0);
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const setProctor = <K extends keyof typeof form.settings.proctoring>(k: K, v: (typeof form.settings.proctoring)[K]) => setForm((f) => ({ ...f, settings: { ...f.settings, proctoring: { ...f.settings.proctoring, [k]: v } } }));
  const poolNames = [...new Set(form.questions.map((x) => x.pool).filter((x): x is string => !!x))];
  /** Points within a pool stay equal, so every candidate's test is worth the same. */
  const setPoints = (qid: number, points: number) => setForm((f) => {
    const pool = f.questions.find((x) => x.questionId === qid)?.pool;
    return { ...f, questions: f.questions.map((x) => (x.questionId === qid || (pool && x.pool === pool) ? { ...x, points } : x)) };
  });
  const setPool = (qid: number, raw: string) => setForm((f) => {
    const pool = raw.trim() || null;
    const peer = pool ? f.questions.find((x) => x.pool === pool && x.questionId !== qid) : undefined;
    const questions = f.questions.map((x) => (x.questionId === qid ? { ...x, pool, points: peer?.points ?? x.points } : x));
    const names = new Set(questions.map((x) => x.pool).filter(Boolean) as string[]);
    const pools = Object.fromEntries([...names].map((n) => [n, { draw: Math.min(f.settings.pools[n]?.draw ?? 1, questions.filter((x) => x.pool === n).length) }]));
    return { ...f, questions, settings: { ...f.settings, pools } };
  });
  const drawn = form.questions.filter((x) => !x.pool).reduce((s2, x) => s2 + x.points, 0)
    + poolNames.reduce((s2, n) => s2 + (form.questions.find((x) => x.pool === n)?.points ?? 0) * (form.settings.pools[n]?.draw ?? 1), 0);
  const drawnCount = form.questions.filter((x) => !x.pool).length + poolNames.reduce((s2, n) => s2 + (form.settings.pools[n]?.draw ?? 1), 0);
  const move = (i: number, d: number) => {
    const qs = [...form.questions];
    const [x] = qs.splice(i, 1);
    qs.splice(i + d, 0, x);
    set({ questions: qs });
  };

  const save = async () => {
    setSaving(true);
    setErr(null);
    try {
      if (id) { await api.put(`/api/assessments/${id}`, form); nav(`/hiring/${id}`); }
      else { const r = await api.post<{ id: number }>('/api/assessments', form); nav(`/hiring/${r.id}`); }
    } catch (e: any) { setErr(e.message); } finally { setSaving(false); }
  };

  if (!lib) return <PageLoader />;
  const langs = (meta?.languages ?? []).filter((l) => l.available);
  return (
    <Page>
      <PageHeader title={id ? 'Edit assessment' : 'New assessment'} actions={<><Button onClick={() => nav(-1)}>Cancel</Button><Button variant="primary" onClick={save} loading={saving} disabled={!form.title || !form.questions.length}>Save</Button></>} />
      <ErrorBox error={err} />
      <div className="mt-4 grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <Card className="space-y-4 p-5">
            <div><Label>Title</Label><Input value={form.title} onChange={(e) => set({ title: e.target.value })} placeholder="e.g. Senior Backend Engineer — Take-home screen" /></div>
            <div><Label hint="Markdown supported">Instructions for candidates</Label><Textarea rows={3} value={form.description} onChange={(e) => set({ description: e.target.value })} className="font-sans text-sm" /></div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Duration (minutes)</Label><Input type="number" min={5} max={600} value={form.durationMin} onChange={(e) => set({ durationMin: Number(e.target.value) })} /></div>
              <div><Label>Status</Label><Select value={form.status} onChange={(e) => set({ status: e.target.value })}><option value="active">Active — accepting candidates</option><option value="draft">Draft</option><option value="closed">Closed</option></Select></div>
            </div>
          </Card>
          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold text-ink-100">Questions</h2>
              <span className="text-sm text-ink-400">{poolNames.length ? `each candidate gets ${drawnCount} questions · ${drawn} points` : `${form.questions.length} · ${total} points`}</span>
            </div>
            <datalist id="pool-names">{poolNames.map((n) => <option key={n} value={n} />)}</datalist>
            {!form.questions.length && <p className="rounded-lg border border-dashed border-ink-700 p-6 text-center text-sm text-ink-400">Add questions from the library on the right.</p>}
            <ol className="space-y-2">
              {form.questions.map((s, i) => {
                const x = byId.get(s.questionId);
                return (
                  <li key={s.questionId} className="flex items-center gap-3 rounded-lg border border-ink-800 bg-ink-850 px-3 py-2">
                    <span className="w-5 text-xs text-ink-500">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-ink-100">{x?.title ?? `#${s.questionId}`}</div>
                      <div className="flex gap-2 text-xs text-ink-400">{x && <><span className="uppercase">{x.type}</span><Difficulty d={x.difficulty} /></>}</div>
                    </div>
                    <Input list="pool-names" value={s.pool ?? ''} aria-label="Pool" placeholder="pool" title="Questions sharing a pool name are drawn at random per candidate" onChange={(e) => setPool(s.questionId, e.target.value)} className={cx('w-28 py-1 text-xs', s.pool && 'ring-1 ring-ember-500/60')} />
                    <Input type="number" min={1} max={1000} value={s.points} aria-label="Points" onChange={(e) => setPoints(s.questionId, Number(e.target.value))} className="w-20 py-1 text-right" />
                    <span className="text-xs text-ink-500">pts</span>
                    <div className="flex">
                      <button disabled={i === 0} onClick={() => move(i, -1)} className="p-1 text-ink-400 hover:text-ink-100 disabled:opacity-30" aria-label="Move up"><ArrowUp className="size-4" /></button>
                      <button disabled={i === form.questions.length - 1} onClick={() => move(i, 1)} className="p-1 text-ink-400 hover:text-ink-100 disabled:opacity-30" aria-label="Move down"><ArrowDown className="size-4" /></button>
                      <button onClick={() => set({ questions: form.questions.filter((y) => y.questionId !== s.questionId) })} className="p-1 text-ink-400 hover:text-rose-300" aria-label="Remove"><X className="size-4" /></button>
                    </div>
                  </li>
                );
              })}
            </ol>
          </Card>
          {poolNames.length > 0 && (
            <Card className="p-5">
              <h2 className="mb-1 font-semibold text-ink-100">Question pools</h2>
              <p className="mb-3 text-xs text-ink-400">Each candidate receives a random selection from every pool, so answers are harder to share. Questions in a pool are worth the same points.</p>
              <ul className="space-y-2">
                {poolNames.map((n) => {
                  const members = form.questions.filter((x) => x.pool === n).length;
                  return (
                    <li key={n} className="flex items-center gap-3 text-sm">
                      <span className="rounded-md bg-ember-500/10 px-2 py-0.5 font-medium text-ember-200">{n}</span>
                      <span className="text-ink-400">draw</span>
                      <Select value={form.settings.pools[n]?.draw ?? 1} aria-label={`Questions drawn from pool ${n}`} onChange={(e) => setForm((f) => ({ ...f, settings: { ...f.settings, pools: { ...f.settings.pools, [n]: { draw: Number(e.target.value) } } } }))} className="w-20 py-1">
                        {Array.from({ length: members }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
                      </Select>
                      <span className="text-ink-400">of {members}</span>
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}
          <Card className="p-5">
            <h2 className="mb-1 font-semibold text-ink-100">Proctoring</h2>
            <p className="mb-2 text-xs text-ink-400">Candidates see exactly what is collected before they start. Faces are detected in the candidate’s browser; video is never streamed.</p>
            <div className="flex flex-wrap items-start gap-x-6">
              <div className="min-w-0 flex-1"><Toggle checked={form.settings.proctoring.webcam} onChange={(v) => setProctor('webcam', v)} label="Webcam snapshots" hint="A photo at the start and periodically, plus evidence when nobody — or more than one person — is in view. The camera must stay on." /></div>
              {form.settings.proctoring.webcam && (
                <label className="mt-1.5 flex items-center gap-2 text-xs text-ink-400">every
                  <Select value={form.settings.proctoring.webcamIntervalSec} onChange={(e) => setProctor('webcamIntervalSec', Number(e.target.value))} className="w-24 py-1 text-xs" aria-label="Snapshot interval">
                    {[15, 30, 45, 60, 90, 120].map((v) => <option key={v} value={v}>{v} s</option>)}
                  </Select>
                </label>
              )}
            </div>
            <Toggle checked={form.settings.proctoring.identityCheck} onChange={(v) => setProctor('identityCheck', v)} label="Identity check" hint="Selfie and photo ID before the test, shown next to the snapshots in the report." />
            <Toggle checked={form.settings.proctoring.blockExternalPaste} onChange={(v) => setProctor('blockExternalPaste', v)} label="Block pasting from outside the test" hint="Copy/paste within the candidate’s own code still works. Attempts are recorded." />
            <Toggle checked={form.settings.proctoring.blockCopy} onChange={(v) => setProctor('blockCopy', v)} label="Block copying question text" hint="Makes it harder to paste questions into search engines or AI tools." />
            <Toggle checked={form.settings.proctoring.singleDevice} onChange={(v) => setProctor('singleDevice', v)} label="Lock to one browser" hint="Once started, other browsers and devices are refused. You can unlock from the report." />
            <Toggle checked={form.settings.proctoring.detectMultiMonitor} onChange={(v) => setProctor('detectMultiMonitor', v)} label="Detect a second display" />
            <div className="mt-2 flex items-center gap-2 text-sm text-ink-300">
              Delete images, ID photos and IP/device logs
              <Select value={form.settings.retentionDays} onChange={(e) => setForm((f) => ({ ...f, settings: { ...f.settings, retentionDays: Number(e.target.value) } }))} className="w-32 py-1 text-xs" aria-label="Retention">
                {[7, 30, 90, 180, 365].map((v) => <option key={v} value={v}>{v} days</option>)}
              </Select>
              after submission
            </div>
          </Card>
          <Card className="p-5">
            <h2 className="mb-2 font-semibold text-ink-100">Integrity & experience</h2>
            <Toggle checked={form.settings.proctoring.trackTabs} onChange={(v) => setProctor('trackTabs', v)} label="Track tab switches and window focus" hint="Recorded on the candidate's timeline and counted in the integrity score." />
            <Toggle checked={form.settings.proctoring.detectPaste} onChange={(v) => setProctor('detectPaste', v)} label="Detect pastes" hint="Pastes are allowed but recorded with their size." />
            <Toggle checked={form.settings.proctoring.requireFullscreen} onChange={(v) => setProctor('requireFullscreen', v)} label="Ask for fullscreen" hint="Candidates are prompted to stay in fullscreen; exits are recorded." />
            <Toggle checked={form.settings.proctoring.recordPlayback} onChange={(v) => setProctor('recordPlayback', v)} label="Record code playback" hint="Snapshots let you replay how each solution was written." />
            <Toggle checked={form.settings.shuffleQuestions} onChange={(v) => setForm((f) => ({ ...f, settings: { ...f.settings, shuffleQuestions: v } }))} label="Shuffle question order per candidate" />
            <Toggle checked={form.settings.showScoreToCandidate} onChange={(v) => setForm((f) => ({ ...f, settings: { ...f.settings, showScoreToCandidate: v } }))} label="Show the score to candidates after they submit" />
            <div className="mt-3">
              <Label hint="none selected = all">Allowed languages</Label>
              <div className="flex flex-wrap gap-1.5">
                {langs.map((l) => {
                  const on = form.settings.languages.includes(l.id);
                  return <button key={l.id} type="button" onClick={() => setForm((f) => ({ ...f, settings: { ...f.settings, languages: on ? f.settings.languages.filter((x) => x !== l.id) : [...f.settings.languages, l.id] } }))} className={cx('rounded-md border px-2 py-1 text-xs', on ? 'border-ember-500/60 bg-ember-500/10 text-ember-200' : 'border-ink-700 text-ink-400 hover:border-ink-600')}>{l.name}</button>;
                })}
              </div>
            </div>
          </Card>
        </div>
        <Card className="h-fit p-4 lg:sticky lg:top-20">
          <h2 className="mb-3 font-semibold text-ink-100">Question library</h2>
          <div className="mb-3 flex gap-2">
            <div className="relative flex-1"><Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-ink-500" /><Input placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" aria-label="Search library" /></div>
            <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="w-auto" aria-label="Type"><option value="">All</option><option value="coding">Coding</option><option value="sql">SQL</option><option value="mcq">MCQ</option></Select>
          </div>
          <ul className="max-h-[60vh] space-y-1 overflow-auto pr-1">
            {available.map((x) => (
              <li key={x.id}>
                <button onClick={() => set({ questions: [...form.questions, { questionId: x.id, points: DEFAULT_POINTS[x.type], pool: null }] })} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-ink-800">
                  <Plus className="size-4 shrink-0 text-ember-400" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-ink-100">{x.title}</div>
                    <div className="flex items-center gap-2 text-xs text-ink-400"><span className="uppercase">{x.type}</span><Difficulty d={x.difficulty} />{x.visibility === 'private' && <Badge>private</Badge>}</div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </Page>
  );
}
