import { ArrowLeft, CheckCircle2, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Markdown } from '../components/Markdown';
import { Badge, Button, Difficulty, ErrorBox, PageLoader, VerdictBadge } from '../components/ui';
import { Workspace } from '../components/Workspace';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ago, cx, mem, ms } from '../lib/format';
import type { Problem, Submission } from '../lib/types';

function McqPractice({ problem }: { problem: Problem }) {
  const [choice, setChoice] = useState<string[]>([]);
  const [res, setRes] = useState<{ correct: boolean; answer: string[]; explanation: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const toggle = (id: string) => {
    setRes(null);
    setChoice((c) => (problem.multiple ? (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]) : [id]));
  };
  const check = async () => {
    try { setRes(await api.post(`/api/problems/${problem.slug}/answer`, { choice: problem.multiple ? choice : choice[0] })); } catch (e: any) { setErr(e.message); }
  };
  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <Link to="/problems" className="mb-4 inline-flex items-center gap-1 text-sm text-ink-400 hover:text-ink-200"><ArrowLeft className="size-4" /> Problems</Link>
      <h1 className="text-xl font-semibold text-ink-100">{problem.title}</h1>
      <div className="mt-2 flex gap-2"><Difficulty d={problem.difficulty} />{problem.tags.map((t) => <Badge key={t}>{t}</Badge>)}</div>
      <div className="mt-4"><Markdown>{problem.statement}</Markdown></div>
      {problem.multiple && <p className="mt-2 text-xs text-ink-400">Select all that apply.</p>}
      <div className="mt-4 space-y-2">
        {problem.options!.map((o) => {
          const picked = choice.includes(o.id);
          const isAnswer = res?.answer.includes(o.id);
          return (
            <button key={o.id} onClick={() => toggle(o.id)} className={cx('flex w-full items-start gap-3 rounded-lg border px-4 py-3 text-left text-sm transition-colors',
              res ? (isAnswer ? 'border-emerald-500/50 bg-emerald-500/10' : picked ? 'border-rose-500/50 bg-rose-500/10' : 'border-ink-800') : picked ? 'border-ember-500/60 bg-ember-500/10' : 'border-ink-800 hover:border-ink-600')}>
              <span className="mt-0.5 font-mono text-xs text-ink-400">{o.id.toUpperCase()}</span>
              <span className="prose-crucible flex-1 [&_p]:m-0"><Markdown>{o.text}</Markdown></span>
            </button>
          );
        })}
      </div>
      <div className="mt-4 flex items-center gap-3">
        <Button variant="primary" onClick={check} disabled={!choice.length}>Check answer</Button>
        {res && (res.correct ? <span className="flex items-center gap-1.5 text-sm text-emerald-300"><CheckCircle2 className="size-4" /> Correct</span> : <span className="flex items-center gap-1.5 text-sm text-rose-300"><XCircle className="size-4" /> Not quite</span>)}
      </div>
      <div className="mt-3"><ErrorBox error={err} /></div>
      {res?.explanation && <div className="mt-4 rounded-lg border border-ink-800 bg-ink-900 p-4 text-sm text-ink-300"><Markdown>{res.explanation}</Markdown></div>}
    </div>
  );
}

function History({ slug, refresh }: { slug: string; refresh: number }) {
  const { user } = useAuth();
  const [subs, setSubs] = useState<Submission[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => { if (user) api.get<{ submissions: Submission[] }>(`/api/problems/${slug}/submissions`).then((r) => setSubs(r.submissions)).catch(() => setSubs([])); }, [slug, refresh, user]);
  if (!user) return <p className="text-sm text-ink-400"><Link to="/login" className="text-ember-400">Sign in</Link> to keep a history of your submissions.</p>;
  if (!subs) return <PageLoader />;
  if (!subs.length) return <p className="text-sm text-ink-400">No submissions yet.</p>;
  return (
    <ul className="space-y-2">
      {subs.map((s) => (
        <li key={s.id} className="rounded-lg border border-ink-800">
          <button onClick={() => setOpen(open === s.id ? null : s.id)} className="flex w-full items-center gap-3 px-3 py-2 text-left text-xs">
            <VerdictBadge verdict={s.verdict} />
            <span className="text-ink-300">{s.language}</span>
            <span className="text-ink-500">{s.passed}/{s.total}</span>
            <span className="text-ink-500">{ms(s.timeMs)} · {mem(s.memoryKb)}</span>
            {s.complexity && <span className={s.complexity.meetsTarget ? 'text-emerald-300' : 'text-rose-300'}>{s.complexity.estimate}</span>}
            <span className="ml-auto text-ink-500">{ago(s.createdAt)}</span>
          </button>
          {open === s.id && <pre className="max-h-72 overflow-auto border-t border-ink-800 bg-ink-950 p-3 font-mono text-xs text-ink-200">{s.code}</pre>}
        </li>
      ))}
    </ul>
  );
}

export function Solve() {
  const { slug } = useParams();
  const [problem, setProblem] = useState<Problem | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    setProblem(null);
    api.get<{ problem: Problem }>(`/api/problems/${slug}`).then((r) => setProblem(r.problem)).catch((e) => setErr(e.message));
  }, [slug]);
  if (err) return <div className="p-8"><ErrorBox error={err} /></div>;
  if (!problem) return <PageLoader />;
  if (problem.type === 'mcq') return <McqPractice problem={problem} />;
  return (
    <div className="lg:h-[calc(100vh-3.5rem)]">
      <Workspace
        key={problem.slug}
        problem={problem}
        storageKey={`practice:${problem.slug}`}
        onJudged={(s) => s.kind === 'submit' && setRefresh((x) => x + 1)}
        headerExtra={<Link to="/problems" className="flex items-center gap-1 text-xs text-ink-400 hover:text-ink-200"><ArrowLeft className="size-3.5" /> All problems</Link>}
        sideTabs={[{ id: 'history', label: 'Submissions', render: () => <History slug={problem.slug} refresh={refresh} /> }]}
      />
    </div>
  );
}
