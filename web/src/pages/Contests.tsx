import { CalendarClock, ChevronRight, Flag, Plus, Radio, Trophy, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Page, PageHeader } from '../components/Layout';
import { Badge, Button, Empty, ErrorBox, Skeleton } from '../components/ui';
import { api } from '../lib/api';
import { isStaff, useAuth } from '../lib/auth';
import { cx } from '../lib/format';
import { longDuration, useCountdown } from '../lib/useCountdown';

export interface ContestSummary {
  id: number; slug: string; title: string; description: string; startsAt: number; endsAt: number; penaltyMin: number; freezeMin: number;
  status: 'upcoming' | 'running' | 'ended'; frozen: boolean; problems: number; participants: number; joined: boolean;
}

export const STATUS_BADGE = {
  running: 'border-emerald-500/40 text-emerald-300',
  upcoming: 'border-sky-500/40 text-sky-300',
  ended: 'border-ink-600 text-ink-400',
};

function Featured({ c, serverNow }: { c: ContestSummary; serverNow: number }) {
  const left = useCountdown(c.status === 'running' ? c.endsAt : c.startsAt, serverNow);
  const total = c.endsAt - c.startsAt;
  const elapsed = c.status === 'running' ? Math.min(100, Math.max(0, ((total - left) / total) * 100)) : 0;
  return (
    <Link to={`/contests/${c.slug}`} className="group block overflow-hidden rounded-2xl border border-emerald-500/30 bg-[radial-gradient(ellipse_at_top_left,rgba(16,185,129,.14),transparent_60%)] p-6 transition hover:border-emerald-500/60">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-emerald-300 uppercase"><Radio className="size-3.5 animate-ember" /> Live now</span>
        <span className="text-xs text-ink-400">{c.participants} competing · {c.problems} problems</span>
      </div>
      <h2 className="mt-2 text-2xl font-semibold tracking-tight text-ink-100 group-hover:text-emerald-200">{c.title}</h2>
      <div className="mt-4 flex flex-wrap items-end gap-6">
        <div>
          <div className="text-xs text-ink-400">Ends in</div>
          <div className="font-mono text-3xl font-semibold tabular-nums text-ink-100">{longDuration(left)}</div>
        </div>
        <div className="min-w-48 flex-1">
          <div className="h-2 overflow-hidden rounded-full bg-ink-800"><div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-300" style={{ width: `${elapsed}%` }} /></div>
          <div className="mt-1 text-[11px] text-ink-400">{Math.round(elapsed)}% elapsed{c.freezeMin ? ` · scoreboard freezes for the last ${c.freezeMin} min` : ''}</div>
        </div>
        <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-on-accent">{c.joined ? 'Continue' : 'Enter contest'} <ChevronRight className="size-4" /></span>
      </div>
    </Link>
  );
}

function Row({ c, serverNow }: { c: ContestSummary; serverNow: number }) {
  const left = useCountdown(c.status === 'upcoming' ? c.startsAt : c.endsAt, serverNow);
  return (
    <Link to={`/contests/${c.slug}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-4 hover:bg-ink-850/60">
      <span className={cx('grid size-10 place-items-center rounded-lg', c.status === 'upcoming' ? 'bg-sky-500/10 text-sky-300' : 'bg-ink-800 text-ink-400')}>
        {c.status === 'upcoming' ? <CalendarClock className="size-5" /> : <Flag className="size-5" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2"><span className="truncate font-medium text-ink-100">{c.title}</span><Badge className={STATUS_BADGE[c.status]}>{c.status}</Badge>{c.joined && <Badge className="border-ember-500/40 text-ember-300">joined</Badge>}</div>
        <div className="mt-0.5 text-xs text-ink-400">{new Date(c.startsAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })} · {Math.round((c.endsAt - c.startsAt) / 60_000)} min · {c.problems} problems</div>
      </div>
      <span className="flex items-center gap-1 text-xs text-ink-400"><Users className="size-3.5" /> {c.participants}</span>
      <span className="w-36 text-right text-xs text-ink-300">{c.status === 'upcoming' ? <>starts in <b className="font-mono tabular-nums">{longDuration(left)}</b></> : 'final standings'}</span>
    </Link>
  );
}

export function Contests() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [data, setData] = useState<{ contests: ContestSummary[]; serverNow: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api.get<{ contests: ContestSummary[]; serverNow: number }>('/api/contests').then(setData).catch((e) => setErr(e.message)); }, []);
  const running = data?.contests.filter((c) => c.status === 'running') ?? [];
  const upcoming = data?.contests.filter((c) => c.status === 'upcoming').reverse() ?? [];
  const ended = data?.contests.filter((c) => c.status === 'ended') ?? [];
  return (
    <Page>
      <PageHeader eyebrow="Compete" title="Contests" subtitle="Timed rounds with live standings. Solve the most problems; ties go to the lowest penalty time."
        actions={isStaff(user) ? <Button onClick={() => nav('/contests/new')}><Plus className="size-4" /> New contest</Button> : undefined} />
      <ErrorBox error={err} />
      {!data ? <Skeleton className="h-48" /> : (
        <div className="space-y-6">
          {running.map((c) => <Featured key={c.id} c={c} serverNow={data.serverNow} />)}
          {upcoming.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-semibold text-ink-200">Upcoming</h2>
              <div className="divide-y divide-ink-800 overflow-hidden rounded-xl border border-ink-800 bg-ink-900/60">{upcoming.map((c) => <Row key={c.id} c={c} serverNow={data.serverNow} />)}</div>
            </section>
          )}
          {ended.length > 0 && (
            <section>
              <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink-200"><Trophy className="size-4 text-amber-300" /> Past contests</h2>
              <div className="divide-y divide-ink-800 overflow-hidden rounded-xl border border-ink-800 bg-ink-900/60">{ended.map((c) => <Row key={c.id} c={c} serverNow={data.serverNow} />)}</div>
            </section>
          )}
          {!data.contests.length && <Empty title="No contests yet">{isStaff(user) ? 'Create one from your question library.' : 'Check back soon.'}</Empty>}
        </div>
      )}
    </Page>
  );
}
