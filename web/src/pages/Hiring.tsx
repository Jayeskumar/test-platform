import { ClipboardList, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Page, PageHeader } from '../components/Layout';
import { Badge, Button, Empty, ErrorBox, PageLoader } from '../components/ui';
import { api } from '../lib/api';
import { ago, cx } from '../lib/format';

interface Row { id: number; title: string; status: string; durationMin: number; createdAt: number; questions: number; invited: number; started: number; completed: number; avgPct: number | null }

export function Hiring() {
  const nav = useNavigate();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api.get<{ assessments: Row[] }>('/api/assessments').then((r) => setRows(r.assessments)).catch((e) => setErr(e.message)); }, []);
  return (
    <Page>
      <PageHeader title="Assessments" subtitle="Create timed tests, invite candidates by link and review evidence-rich reports." actions={<Button variant="primary" onClick={() => nav('/hiring/new')}><Plus className="size-4" /> New assessment</Button>} />
      <ErrorBox error={err} />
      {!rows ? <PageLoader /> : !rows.length ? <Empty title="No assessments yet">Create one from the question library to start inviting candidates.</Empty> : (
        <div className="grid gap-3 md:grid-cols-2">
          {rows.map((a) => (
            <Link key={a.id} to={`/hiring/${a.id}`} className="group rounded-xl border border-ink-800 bg-ink-900/70 p-5 transition-colors hover:border-ink-600">
              <div className="flex items-start gap-3">
                <ClipboardList className="mt-0.5 size-5 text-ember-400" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h2 className="truncate font-semibold text-ink-100 group-hover:text-ember-200">{a.title}</h2>
                    <Badge className={cx(a.status === 'active' ? 'border-emerald-500/30 text-emerald-300' : 'border-ink-600 text-ink-400')}>{a.status}</Badge>
                  </div>
                  <div className="mt-1 text-xs text-ink-400">{a.questions} questions · {a.durationMin} min · created {ago(a.createdAt)}</div>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-4 gap-2 text-center">
                {[['Invited', a.invited], ['Started', a.started], ['Completed', a.completed], ['Avg score', a.avgPct == null ? '—' : `${a.avgPct}%`]].map(([l, v]) => (
                  <div key={l as string} className="rounded-lg bg-ink-850 py-2"><div className="text-lg font-semibold tabular-nums text-ink-100">{v}</div><div className="text-[11px] text-ink-400">{l}</div></div>
                ))}
              </div>
            </Link>
          ))}
        </div>
      )}
    </Page>
  );
}
