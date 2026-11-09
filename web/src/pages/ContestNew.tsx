import { Plus, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Page, PageHeader } from '../components/Layout';
import { Button, Card, Difficulty, ErrorBox, Input, Label, Textarea } from '../components/ui';
import { api } from '../lib/api';
import { useToast } from '../lib/toast';

export function ContestNew() {
  const nav = useNavigate();
  const toast = useToast();
  const [lib, setLib] = useState<any[]>([]);
  const local = (t: number) => new Date(t - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  const [f, setF] = useState({ title: '', description: '', start: local(Date.now() + 3600_000), durationMin: 120, penaltyMin: 20, freezeMin: 30, problems: [] as number[] });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get<{ questions: any[] }>('/api/library/questions').then((r) => setLib(r.questions.filter((q) => q.type !== 'mcq'))).catch((e) => setErr(e.message)); }, []);
  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api.post<{ slug: string }>('/api/contests', { title: f.title, description: f.description, startsAt: new Date(f.start).getTime(), durationMin: f.durationMin, penaltyMin: f.penaltyMin, freezeMin: f.freezeMin, problems: f.problems });
      toast.success('Contest created');
      nav(`/contests/${r.slug}`);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const byId = new Map(lib.map((q) => [q.id, q]));
  return (
    <Page>
      <PageHeader title="New contest" actions={<><Button onClick={() => nav(-1)}>Cancel</Button><Button variant="primary" onClick={save} loading={busy} disabled={!f.title || !f.problems.length}>Create</Button></>} />
      <ErrorBox error={err} />
      <div className="mt-4 grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          <Card className="space-y-4 p-5">
            <div><Label>Title</Label><Input aria-label="Title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Weekly Sprint #44" /></div>
            <div><Label hint="Markdown">Description</Label><Textarea aria-label="Description" rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} className="font-sans text-sm" /></div>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div className="col-span-2"><Label>Starts</Label><Input aria-label="Starts" type="datetime-local" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></div>
              <div><Label>Minutes</Label><Input aria-label="Duration in minutes" type="number" min={10} value={f.durationMin} onChange={(e) => setF({ ...f, durationMin: Number(e.target.value) })} /></div>
              <div><Label hint="min">Penalty</Label><Input aria-label="Penalty minutes" type="number" min={0} value={f.penaltyMin} onChange={(e) => setF({ ...f, penaltyMin: Number(e.target.value) })} /></div>
            </div>
            <div className="max-w-xs"><Label hint="last N minutes, 0 = off">Scoreboard freeze</Label><Input aria-label="Freeze minutes" type="number" min={0} value={f.freezeMin} onChange={(e) => setF({ ...f, freezeMin: Number(e.target.value) })} /></div>
          </Card>
          <Card className="p-5">
            <h2 className="mb-3 font-semibold text-ink-100">Problems ({f.problems.length})</h2>
            {!f.problems.length && <p className="text-sm text-ink-400">Add coding or SQL questions from the library — they become A, B, C…</p>}
            <ol className="space-y-2">
              {f.problems.map((id, i) => (
                <li key={id} className="flex items-center gap-3 rounded-lg border border-ink-800 bg-ink-850 px-3 py-2 text-sm">
                  <span className="grid size-7 place-items-center rounded-md bg-ink-800 font-semibold text-ink-200">{String.fromCharCode(65 + i)}</span>
                  <span className="flex-1 text-ink-100">{byId.get(id)?.title}</span>
                  <button onClick={() => setF({ ...f, problems: f.problems.filter((x) => x !== id) })} className="text-ink-400 hover:text-rose-300" aria-label={`Remove ${byId.get(id)?.title}`}><X className="size-4" /></button>
                </li>
              ))}
            </ol>
          </Card>
        </div>
        <Card className="h-fit p-4">
          <h2 className="mb-3 font-semibold text-ink-100">Library</h2>
          <ul className="max-h-[60vh] space-y-1 overflow-auto">
            {lib.filter((q) => !f.problems.includes(q.id)).map((q) => (
              <li key={q.id}>
                <button onClick={() => setF({ ...f, problems: [...f.problems, q.id] })} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-ink-800">
                  <Plus className="size-4 text-ember-400" />
                  <span className="flex-1 truncate text-sm text-ink-100">{q.title}</span>
                  <Difficulty d={q.difficulty} />
                </button>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </Page>
  );
}
