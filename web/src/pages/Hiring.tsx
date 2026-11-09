import { ArrowRight, ClipboardList, Clock, Inbox, Plus, Search, ShieldAlert, Timer, Zap } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Page, PageHeader } from '../components/Layout';
import { Badge, Button, Card, Empty, ErrorBox, Input, Skeleton } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ago, cx } from '../lib/format';
import { INTEGRITY_CLS } from './AssessmentDetail';

interface Row { role?: 'owner' | 'editor' | 'reviewer' | null; id: number; title: string; status: string; durationMin: number; createdAt: number; questions: number; invited: number; started: number; completed: number; avgPct: number | null }
interface Overview {
  stats: { activeAssessments: number; inProgress: number; completedThisWeek: number; awaitingReview: number; flagged: number };
  awaitingReview: { attemptId: number; name: string; assessmentId: number; assessment: string; scorePct: number | null; submittedAt: number; integrity: { score: number; level: string } | null }[];
}

const STATUS_CLS: Record<string, string> = { active: 'border-emerald-500/30 text-emerald-300', draft: 'border-amber-500/30 text-amber-300', closed: 'border-ink-600 text-ink-400' };

function StatTile({ icon: Icon, label, value, tone }: { icon: any; label: string; value: number | string; tone?: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-ink-700/70 bg-ink-900/80 px-4 py-3">
      <span className={cx('grid size-10 place-items-center rounded-lg bg-ink-800', tone ?? 'text-ink-300')}><Icon className="size-5" /></span>
      <div>
        <div className="text-2xl font-semibold tabular-nums text-ink-100">{value}</div>
        <div className="text-xs text-ink-400">{label}</div>
      </div>
    </div>
  );
}

export function Hiring() {
  const nav = useNavigate();
  const { user } = useAuth();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [ov, setOv] = useState<Overview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'all' | 'active' | 'draft' | 'closed'>('all');
  useEffect(() => {
    api.get<{ assessments: Row[] }>('/api/assessments').then((r) => setRows(r.assessments)).catch((e) => setErr(e.message));
    api.get<Overview>('/api/hiring/overview').then(setOv).catch(() => {});
  }, []);
  const shown = (rows ?? []).filter((a) => (status === 'all' || a.status === status) && (!q || a.title.toLowerCase().includes(q.toLowerCase())));
  const hour = new Date().getHours();
  return (
    <Page>
      <PageHeader
        eyebrow="Hiring"
        title={`Good ${hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening'}, ${user?.name.split(' ')[0] ?? ''}`}
        subtitle="Here’s what needs your attention."
        actions={<Button variant="primary" onClick={() => nav('/hiring/new')}><Plus className="size-4" /> New assessment</Button>}
      />
      <ErrorBox error={err} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {ov ? (
          <>
            <StatTile icon={Inbox} label="Awaiting your review" value={ov.stats.awaitingReview} tone="text-ember-300" />
            <StatTile icon={ShieldAlert} label="Flagged, not reviewed" value={ov.stats.flagged} tone={ov.stats.flagged ? 'text-amber-300' : undefined} />
            <StatTile icon={Timer} label="Taking a test now" value={ov.stats.inProgress} tone="text-sky-300" />
            <StatTile icon={Zap} label="Completed this week" value={ov.stats.completedThisWeek} tone="text-emerald-300" />
          </>
        ) : Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[66px]" />)}
      </div>

      {ov && ov.awaitingReview.length > 0 && (
        <Card className="mt-4 p-0">
          <div className="flex items-center justify-between border-b border-ink-800 px-5 py-3">
            <h2 className="flex items-center gap-2 font-semibold text-ink-100"><Inbox className="size-4 text-ember-400" /> Needs your review</h2>
            <span className="text-xs text-ink-500">newest first</span>
          </div>
          <ul className="divide-y divide-ink-800">
            {ov.awaitingReview.map((r) => (
              <li key={r.attemptId}>
                <Link to={`/hiring/attempts/${r.attemptId}`} className="group flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 hover:bg-ink-850/60">
                  <span className="grid size-8 place-items-center rounded-full bg-ink-800 text-xs font-semibold text-ink-200">{r.name.slice(0, 1).toUpperCase()}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-ink-100">{r.name}</div>
                    <div className="truncate text-xs text-ink-400">{r.assessment} · {ago(r.submittedAt)}</div>
                  </div>
                  {r.scorePct != null && <span className="w-12 text-right text-sm font-semibold tabular-nums text-ink-100">{r.scorePct}%</span>}
                  {r.integrity && <Badge className={INTEGRITY_CLS[r.integrity.level]}>{r.integrity.score} · {r.integrity.level}</Badge>}
                  <ArrowRight className="size-4 text-ink-500 transition-transform group-hover:translate-x-0.5 group-hover:text-ink-200" />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="mt-8 mb-3 flex flex-wrap items-center gap-3">
        <h2 className="mr-auto text-lg font-semibold text-ink-100">Assessments</h2>
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-ink-500" />
          <Input placeholder="Search assessments" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" aria-label="Search assessments" />
        </div>
        <div role="tablist" aria-label="Status" className="inline-flex rounded-lg border border-ink-700 bg-ink-900 p-0.5">
          {(['all', 'active', 'draft', 'closed'] as const).map((s) => (
            <button key={s} role="tab" aria-selected={status === s} onClick={() => setStatus(s)} className={cx('rounded-md px-3 py-1.5 text-xs font-medium capitalize', status === s ? 'bg-ink-700 text-ink-100' : 'text-ink-400 hover:text-ink-100')}>{s}</button>
          ))}
        </div>
      </div>
      {!rows ? (
        <div className="grid gap-3 md:grid-cols-2">{Array.from({ length: 2 }, (_, i) => <Skeleton key={i} className="h-44" />)}</div>
      ) : !rows.length ? (
        <Empty title="No assessments yet">Create one from the question library to start inviting candidates.</Empty>
      ) : !shown.length ? (
        <Empty title="No assessments match">Try a different search or status.</Empty>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {shown.map((a) => {
            const done = a.invited ? Math.round((a.completed / a.invited) * 100) : 0;
            return (
              <Link key={a.id} to={`/hiring/${a.id}`} className="group rounded-xl border border-ink-800 bg-ink-900/70 p-5 transition-all hover:-translate-y-0.5 hover:border-ink-600 hover:shadow-lg hover:shadow-black/10">
                <div className="flex items-start gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-ember-500/10"><ClipboardList className="size-5 text-ember-400" /></span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate font-semibold text-ink-100 group-hover:text-ember-200">{a.title}</h3>
                      <Badge className={STATUS_CLS[a.status]}>{a.status}</Badge>
                      {a.role && a.role !== 'owner' && <Badge className="border-sky-500/40 text-sky-300">shared · {a.role}</Badge>}
                    </div>
                    <div className="mt-0.5 flex items-center gap-3 text-xs text-ink-400"><span>{a.questions} questions</span><span className="flex items-center gap-1"><Clock className="size-3" />{a.durationMin} min</span><span>created {ago(a.createdAt)}</span></div>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-4 gap-2 text-center">
                  {[['Invited', a.invited], ['Started', a.started], ['Completed', a.completed], ['Avg score', a.avgPct == null ? '—' : `${a.avgPct}%`]].map(([l, v]) => (
                    <div key={l as string} className="rounded-lg bg-ink-850 py-2"><div className="text-lg font-semibold tabular-nums text-ink-100">{v}</div><div className="text-[11px] text-ink-400">{l}</div></div>
                  ))}
                </div>
                <div className="mt-3 flex items-center gap-2 text-[11px] text-ink-400">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-800"><div className="h-full rounded-full bg-gradient-to-r from-amber-400 to-ember-500" style={{ width: `${done}%` }} /></div>
                  {done}% completed
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </Page>
  );
}
