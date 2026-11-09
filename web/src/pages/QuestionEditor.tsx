import { CheckCircle2, Plus, Trash2, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ComplexityCard } from '../components/charts';
import { CodeEditor } from '../components/CodeEditor';
import { Page, PageHeader } from '../components/Layout';
import { Markdown } from '../components/Markdown';
import { Button, Card, ErrorBox, Input, Label, PageLoader, Select, Tabs, Textarea, Toggle, VerdictBadge } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { cx, ms } from '../lib/format';

interface TC { input: string; expected: string; is_sample: boolean; weight: number; explanation: string }
interface Form {
  type: 'coding' | 'sql' | 'mcq'; title: string; difficulty: 'easy' | 'medium' | 'hard'; tags: string; statement: string; visibility: 'public' | 'private';
  data: any; tests: TC[];
}

const blank = (type: Form['type']): Form => ({
  type, title: '', difficulty: 'medium', tags: '', statement: '', visibility: 'private',
  data: type === 'coding'
    ? { limits: { timeMs: 2000, memoryMb: 256 }, checker: { type: 'tokens' }, reference: { language: 'python', code: '' } }
    : type === 'sql' ? { schema: '', solution: '', ordered: true }
    : { options: [{ id: 'a', text: '' }, { id: 'b', text: '' }], correct: [], explanation: '' },
  tests: type === 'mcq' ? [] : [{ input: '', expected: '', is_sample: true, weight: 1, explanation: '' }],
});

export function QuestionEditor() {
  const { id } = useParams();
  const nav = useNavigate();
  const { meta } = useAuth();
  const [f, setF] = useState<Form | null>(id ? null : blank('coding'));
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<'edit' | 'preview'>('edit');
  const [validation, setValidation] = useState<any>(null);
  const [validating, setValidating] = useState(false);

  useEffect(() => {
    if (!id) return;
    api.get<{ question: any }>(`/api/library/questions/${id}`).then(({ question: q }) => setF({
      type: q.type, title: q.title, difficulty: q.difficulty, tags: q.tags.join(', '), statement: q.statement, visibility: q.visibility, data: q.data,
      tests: q.tests.map((t: any) => ({ input: t.input, expected: t.expected, is_sample: t.is_sample, weight: t.weight, explanation: t.explanation })),
    })).catch((e) => setErr(e.message));
  }, [id]);

  if (!f) return err ? <Page><ErrorBox error={err} /></Page> : <PageLoader />;
  const set = (patch: Partial<Form>) => setF({ ...f, ...patch });
  const setData = (patch: any) => setF({ ...f, data: { ...f.data, ...patch } });
  const setTest = (i: number, patch: Partial<TC>) => set({ tests: f.tests.map((t, k) => (k === i ? { ...t, ...patch } : t)) });

  const save = async () => {
    setSaving(true);
    setErr(null);
    const data = { ...f.data };
    if (f.type === 'mcq') data.multiple = (data.correct ?? []).length > 1;
    if (f.type === 'coding' && data.complexity && !data.complexity.generator?.trim()) delete data.complexity;
    // Large expected outputs are recomputed from the reference when left empty.
    const body = { type: f.type, title: f.title, difficulty: f.difficulty, statement: f.statement, visibility: f.visibility, tags: f.tags.split(',').map((t) => t.trim()).filter(Boolean), data, tests: f.tests };
    try {
      if (id) { await api.put(`/api/library/questions/${id}`, body); nav(0); }
      else { const r = await api.post<{ id: number }>('/api/library/questions', body); nav(`/library/${r.id}`, { replace: true }); }
    } catch (e: any) { setErr(e.message); window.scrollTo({ top: 0, behavior: 'smooth' }); } finally { setSaving(false); }
  };
  const validate = async () => {
    setValidating(true);
    setValidation(null);
    try { setValidation(await api.post(`/api/library/questions/${id}/validate`)); } catch (e: any) { setErr(e.message); } finally { setValidating(false); }
  };
  const del = async () => {
    if (!confirm('Delete this question permanently?')) return;
    try { await api.del(`/api/library/questions/${id}`); nav('/library'); } catch (e: any) { setErr(e.message); }
  };
  const langs = (meta?.languages ?? []).filter((l) => l.available);
  return (
    <Page>
      <PageHeader
        title={id ? 'Edit question' : 'New question'}
        actions={<>
          {id && <Button variant="ghost" onClick={del}><Trash2 className="size-4" /> Delete</Button>}
          {id && f.type !== 'mcq' && <Button onClick={validate} loading={validating}>Validate tests</Button>}
          <Button variant="primary" onClick={save} loading={saving} disabled={!f.title || !f.statement}>Save</Button>
        </>}
      />
      <ErrorBox error={err} />
      {validation && (
        <Card className="mb-4 p-4">
          <div className="flex items-center gap-2 text-sm">{validation.verdict === 'AC' ? <CheckCircle2 className="size-4 text-emerald-400" /> : <XCircle className="size-4 text-rose-400" />}<span className="text-ink-100">Reference solution: {validation.passed}/{validation.total} tests pass</span></div>
          <div className="mt-2 flex flex-wrap gap-1.5">{validation.results.map((r: any) => <span key={r.index} className="flex items-center gap-1 text-xs text-ink-400"><VerdictBadge verdict={r.verdict} />#{r.index + 1} {ms(r.timeMs)}</span>)}</div>
          {validation.complexity && <div className="mt-3"><ComplexityCard report={validation.complexity} /></div>}
        </Card>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-4 p-5">
          {!id && (
            <div><Label>Type</Label>
              <div className="grid grid-cols-3 gap-2">{(['coding', 'sql', 'mcq'] as const).map((t) => <button key={t} onClick={() => setF({ ...blank(t), title: f.title, statement: f.statement })} className={cx('rounded-lg border px-3 py-2 text-sm', f.type === t ? 'border-ember-500/60 bg-ember-500/10 text-ink-100' : 'border-ink-700 text-ink-400')}>{t === 'mcq' ? 'Multiple choice' : t === 'sql' ? 'SQL' : 'Coding'}</button>)}</div>
            </div>
          )}
          <div><Label>Title</Label><Input value={f.title} onChange={(e) => set({ title: e.target.value })} /></div>
          <div className="grid grid-cols-3 gap-3">
            <div><Label>Difficulty</Label><Select value={f.difficulty} onChange={(e) => set({ difficulty: e.target.value as any })}><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option></Select></div>
            <div className="col-span-2"><Label hint="comma separated">Topics</Label><Input value={f.tags} onChange={(e) => set({ tags: e.target.value })} placeholder="graphs, bfs" /></div>
          </div>
          <Toggle checked={f.visibility === 'public'} onChange={(v) => set({ visibility: v ? 'public' : 'private' })} label="Public" hint="Public questions appear in practice. Keep assessment questions private." />
          <div>
            <div className="mb-1.5 flex items-center justify-between"><Label>Statement (Markdown)</Label><Tabs value={preview} onChange={setPreview} tabs={[{ id: 'edit', label: 'Write' }, { id: 'preview', label: 'Preview' }]} /></div>
            {preview === 'edit' ? <Textarea rows={14} value={f.statement} onChange={(e) => set({ statement: e.target.value })} className="font-sans text-sm" /> : <div className="min-h-64 rounded-lg border border-ink-700 p-3"><Markdown>{f.statement || '_Nothing yet_'}</Markdown></div>}
          </div>
        </Card>

        <Card className="space-y-4 p-5">
          {f.type === 'coding' && (
            <>
              <div className="grid grid-cols-3 gap-3">
                <div><Label>Time limit (ms)</Label><Input type="number" value={f.data.limits?.timeMs ?? 2000} onChange={(e) => setData({ limits: { ...f.data.limits, timeMs: Number(e.target.value) } })} /></div>
                <div><Label>Memory (MB)</Label><Input type="number" value={f.data.limits?.memoryMb ?? 256} onChange={(e) => setData({ limits: { ...f.data.limits, memoryMb: Number(e.target.value) } })} /></div>
                <div><Label>Checker</Label>
                  <Select value={f.data.checker?.type ?? 'tokens'} onChange={(e) => setData({ checker: e.target.value === 'custom' ? { type: 'custom', code: 'def check(input_text, expected, output):\n    return output.split() == expected.split()\n' } : e.target.value === 'float' ? { type: 'float', tolerance: 1e-6 } : { type: e.target.value } })}>
                    <option value="tokens">Tokens</option><option value="exact">Exact lines</option><option value="float">Float tolerance</option><option value="unordered">Any line order</option><option value="custom">Custom (Python)</option>
                  </Select>
                </div>
              </div>
              {f.data.checker?.type === 'float' && <div><Label>Tolerance</Label><Input type="number" step="any" value={f.data.checker.tolerance} onChange={(e) => setData({ checker: { ...f.data.checker, tolerance: Number(e.target.value) } })} /></div>}
              {f.data.checker?.type === 'custom' && <div><Label hint="return bool or (bool, message)">Custom checker</Label><div className="h-40 overflow-hidden rounded-lg border border-ink-700"><CodeEditor value={f.data.checker.code} onChange={(v) => setData({ checker: { ...f.data.checker, code: v } })} language="python" /></div></div>}
              <div>
                <div className="mb-1.5 flex items-end justify-between gap-3"><div className="flex-1"><Label hint="fills blank expected outputs">Reference solution</Label></div>
                  <Select value={f.data.reference?.language ?? 'python'} onChange={(e) => setData({ reference: { ...f.data.reference, language: e.target.value } })} className="mb-1.5 w-44 py-1 text-xs" aria-label="Reference language">{langs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select>
                </div>
                <div className="h-56 overflow-hidden rounded-lg border border-ink-700"><CodeEditor value={f.data.reference?.code ?? ''} onChange={(v) => setData({ reference: { ...f.data.reference, code: v } })} language={f.data.reference?.language ?? 'python'} /></div>
              </div>
              <details open={!!f.data.complexity}>
                <summary className="cursor-pointer text-sm text-ink-200">Complexity target (optional)</summary>
                <div className="mt-3 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>Target</Label><Select value={f.data.complexity?.expected ?? 'O(n)'} onChange={(e) => setData({ complexity: { ...(f.data.complexity ?? { sizes: [10000, 20000, 40000, 80000, 160000], generator: '' }), expected: e.target.value } })}>{['O(log n)', 'O(√n)', 'O(n)', 'O(n log n)', 'O(n^2)', 'O(n^3)'].map((o) => <option key={o}>{o}</option>)}</Select></div>
                    <div><Label hint="comma separated">Input sizes</Label><Input value={(f.data.complexity?.sizes ?? [10000, 20000, 40000, 80000, 160000]).join(', ')} onChange={(e) => setData({ complexity: { ...(f.data.complexity ?? { expected: 'O(n)', generator: '' }), sizes: e.target.value.split(',').map((x) => Number(x.trim())).filter((x) => x > 0) } })} /></div>
                  </div>
                  <div><Label hint="def generate(n) -> str; `random` is available">Input generator (Python)</Label>
                    <div className="h-36 overflow-hidden rounded-lg border border-ink-700"><CodeEditor value={f.data.complexity?.generator ?? ''} onChange={(v) => setData({ complexity: { ...(f.data.complexity ?? { expected: 'O(n)', sizes: [10000, 20000, 40000, 80000, 160000] }), generator: v } })} language="python" /></div>
                  </div>
                </div>
              </details>
            </>
          )}
          {f.type === 'sql' && (
            <>
              <div><Label>Schema (DDL)</Label><div className="h-40 overflow-hidden rounded-lg border border-ink-700"><CodeEditor value={f.data.schema} onChange={(v) => setData({ schema: v })} language="sql" /></div></div>
              <div><Label hint="expected results are computed from this">Reference query</Label><div className="h-40 overflow-hidden rounded-lg border border-ink-700"><CodeEditor value={f.data.solution} onChange={(v) => setData({ solution: v })} language="sql" /></div></div>
              <Toggle checked={!!f.data.ordered} onChange={(v) => setData({ ordered: v })} label="Row order matters" hint="Turn off to accept rows in any order." />
            </>
          )}
          {f.type === 'mcq' && (
            <>
              <Label hint="tick every correct option">Options</Label>
              {f.data.options.map((o: any, i: number) => (
                <div key={o.id} className="flex items-start gap-2">
                  <input type="checkbox" className="mt-3 accent-ember-500" checked={f.data.correct.includes(o.id)} aria-label={`Option ${o.id} is correct`} onChange={(e) => setData({ correct: e.target.checked ? [...f.data.correct, o.id] : f.data.correct.filter((c: string) => c !== o.id) })} />
                  <Textarea rows={2} value={o.text} onChange={(e) => setData({ options: f.data.options.map((x: any, k: number) => (k === i ? { ...x, text: e.target.value } : x)) })} className="font-sans text-sm" />
                  <button onClick={() => setData({ options: f.data.options.filter((_: any, k: number) => k !== i), correct: f.data.correct.filter((c: string) => c !== o.id) })} className="mt-2 p-1 text-ink-500 hover:text-rose-300" aria-label="Remove option"><Trash2 className="size-4" /></button>
                </div>
              ))}
              <Button size="sm" onClick={() => setData({ options: [...f.data.options, { id: String.fromCharCode(97 + f.data.options.length), text: '' }] })}><Plus className="size-3.5" /> Add option</Button>
              <div><Label>Explanation</Label><Textarea rows={3} value={f.data.explanation} onChange={(e) => setData({ explanation: e.target.value })} className="font-sans text-sm" /></div>
            </>
          )}
        </Card>
      </div>

      {f.type !== 'mcq' && (
        <Card className="mt-4 p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold text-ink-100">{f.type === 'sql' ? 'Datasets' : 'Test cases'} <span className="text-sm font-normal text-ink-400">({f.tests.length})</span></h2>
            <Button size="sm" onClick={() => set({ tests: [...f.tests, { input: '', expected: '', is_sample: false, weight: 1, explanation: '' }] })}><Plus className="size-3.5" /> Add</Button>
          </div>
          <p className="mb-3 text-xs text-ink-400">{f.type === 'sql' ? 'Each dataset is SQL that populates the schema (INSERT statements). Expected results come from the reference query.' : 'Leave “expected” empty to compute it from the reference solution in the sandbox. Samples are shown to candidates; the rest stay hidden.'}</p>
          <div className="space-y-3">
            {f.tests.map((t, i) => (
              <div key={i} className="rounded-lg border border-ink-800 p-3">
                <div className="mb-2 flex flex-wrap items-center gap-3 text-xs">
                  <span className="font-medium text-ink-200">#{i + 1}</span>
                  <label className="flex items-center gap-1.5 text-ink-300"><input type="checkbox" className="accent-ember-500" checked={t.is_sample} onChange={(e) => setTest(i, { is_sample: e.target.checked })} /> sample (visible)</label>
                  <label className="flex items-center gap-1.5 text-ink-300">weight <input type="number" min={0} step="0.5" value={t.weight} onChange={(e) => setTest(i, { weight: Number(e.target.value) })} className="w-16 rounded border border-ink-700 bg-ink-900 px-1.5 py-0.5" /></label>
                  <button onClick={() => set({ tests: f.tests.filter((_, k) => k !== i) })} className="ml-auto text-ink-500 hover:text-rose-300" aria-label="Remove test"><Trash2 className="size-4" /></button>
                </div>
                <div className={cx('grid gap-2', f.type === 'coding' && 'md:grid-cols-2')}>
                  <Textarea rows={4} value={t.input.length > 20000 ? `${t.input.slice(0, 20000)}\n…` : t.input} readOnly={t.input.length > 20000} onChange={(e) => setTest(i, { input: e.target.value })} placeholder={f.type === 'sql' ? "INSERT INTO ... VALUES ..." : 'stdin'} aria-label="Input" />
                  {f.type === 'coding' && <Textarea rows={4} value={t.expected.length > 20000 ? `${t.expected.slice(0, 20000)}\n…` : t.expected} readOnly={t.expected.length > 20000} onChange={(e) => setTest(i, { expected: e.target.value })} placeholder="expected stdout (blank = compute)" aria-label="Expected output" />}
                </div>
                {t.is_sample && <Input className="mt-2" value={t.explanation} onChange={(e) => setTest(i, { explanation: e.target.value })} placeholder="Explanation shown under the example (optional)" />}
              </div>
            ))}
          </div>
        </Card>
      )}
    </Page>
  );
}
