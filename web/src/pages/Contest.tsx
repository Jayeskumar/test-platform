import { ArrowLeft, Check, Clock, Lock, Radio, Snowflake, Star, Trophy, Users } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Markdown } from '../components/Markdown';
import { Page } from '../components/Layout';
import { Badge, Button, Card, Difficulty, Empty, ErrorBox, PageLoader, Tabs } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { cx } from '../lib/format';
import { useToast } from '../lib/toast';
import { longDuration, useCountdown } from '../lib/useCountdown';
import { type ContestSummary, STATUS_BADGE } from './Contests';

interface Cell { solved: boolean; attempts: number; minute: number | null; pending: number; firstToSolve: boolean }
export interface Standings {
  frozen: boolean; status: string;
  problems: { questionId: number; label: string; solvedBy: number; triedBy: number }[];
  rows: { rank: number; userId: number; name: string; solved: number; penalty: number; cells: Record<number, Cell> }[];
}
interface Detail {
  contest: ContestSummary & { canManage: boolean };
  problems: { label: string; id: number; title: string; difficulty: 'easy' | 'medium' | 'hard'; type: string; mine: 'solved' | 'attempted' | null }[];
  serverNow: number;
}

function CellView({ c }: { c: Cell }) {
  if (c.solved) {
    return (
      <div className={cx('rounded-md px-1 py-1 text-center', c.firstToSolve ? 'bg-emerald-500/30 ring-1 ring-emerald-400/60' : 'bg-emerald-500/15')} title={`${c.firstToSolve ? 'First to solve · ' : ''}accepted at minute ${c.minute}${c.attempts ? ` after ${c.attempts} rejected` : ''}`}>
        <div className="flex items-center justify-center gap-0.5 text-xs font-semibold text-emerald-300">{c.firstToSolve && <Star className="size-3 fill-current" />}+{c.attempts || ''}</div>
        <div className="font-mono text-[10px] text-ink-300">{c.minute}′</div>
      </div>
    );
  }
  if (c.pending) return <div className="rounded-md bg-amber-500/15 px-1 py-1 text-center text-xs font-semibold text-amber-300" title="Result hidden by the freeze or still being judged">?{c.attempts + c.pending}</div>;
  if (c.attempts) return <div className="rounded-md bg-rose-500/10 px-1 py-1 text-center text-xs font-semibold text-rose-300" title={`${c.attempts} rejected`}>−{c.attempts}</div>;
  return <div className="py-1 text-center text-ink-600">·</div>;
}

export function StandingsTable({ s, me }: { s: Standings; me?: number }) {
  if (!s.rows.length) return <Empty title="No participants yet">Standings appear as soon as someone joins.</Empty>;
  return (
    <div className="overflow-x-auto rounded-xl border border-ink-800">
      <table className="w-full text-sm">
        <thead className="bg-ink-900 text-xs text-ink-400">
          <tr>
            <th className="w-12 px-3 py-2 text-left font-medium">#</th>
            <th className="px-3 py-2 text-left font-medium">Name</th>
            <th className="w-16 px-2 py-2 font-medium">Solved</th>
            <th className="w-20 px-2 py-2 font-medium">Penalty</th>
            {s.problems.map((p) => (
              <th key={p.questionId} className="w-16 px-1 py-2 font-medium">
                <div className="text-ink-200">{p.label}</div>
                <div className="text-[10px] font-normal text-ink-500" title={`${p.solvedBy} solved of ${p.triedBy} who tried`}>{p.solvedBy}/{p.triedBy}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {s.rows.map((r) => (
            <tr key={r.userId} className={cx('border-t border-ink-800', r.userId === me && 'bg-ember-500/10')}>
              <td className="px-3 py-2 tabular-nums text-ink-300">{r.rank <= 3 && r.solved > 0 ? <Trophy className={cx('size-4', ['text-amber-300', 'text-ink-200', 'text-orange-400'][r.rank - 1])} aria-label={`Rank ${r.rank}`} /> : r.rank}</td>
              <td className="px-3 py-2 font-medium text-ink-100">{r.name}{r.userId === me && <span className="ml-2 text-xs text-ember-300">you</span>}</td>
              <td className="px-2 py-2 text-center font-semibold tabular-nums text-ink-100">{r.solved}</td>
              <td className="px-2 py-2 text-center tabular-nums text-ink-300">{r.penalty}</td>
              {s.problems.map((p) => <td key={p.questionId} className="px-1 py-1.5"><CellView c={r.cells[p.questionId]} /></td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Live standings over server-sent events. */
export function useStandings(slug: string) {
  const [s, setS] = useState<Standings | null>(null);
  const [live, setLive] = useState(false);
  useEffect(() => {
    const es = new EventSource(`/api/contests/${slug}/standings/stream`);
    es.onopen = () => setLive(true);
    es.onmessage = (m) => setS(JSON.parse(m.data));
    es.onerror = () => setLive(false);
    return () => es.close();
  }, [slug]);
  return { standings: s, live };
}

export function Contest() {
  const { slug = '' } = useParams();
  const { user } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const [d, setD] = useState<Detail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<'problems' | 'standings'>('problems');
  const load = useCallback(() => api.get<Detail>(`/api/contests/${slug}`).then(setD).catch((e) => setErr(e.message)), [slug]);
  useEffect(() => { void load(); }, [load]);
  const c = d?.contest;
  const target = c ? (c.status === 'upcoming' ? c.startsAt : c.endsAt) : null;
  const left = useCountdown(target, d?.serverNow);
  // Reload when the contest starts or ends.
  useEffect(() => { if (c && c.status !== 'ended' && left <= 0 && left > -2000) void load(); }, [left, c, load]);
  const { standings, live } = useStandings(slug);
  if (err) return <Page><ErrorBox error={err} /></Page>;
  if (!d || !c) return <PageLoader />;
  const join = async () => {
    if (!user) return nav('/login', { state: { from: `/contests/${slug}` } });
    try { await api.post(`/api/contests/${slug}/join`); toast.success('You’re in — good luck!'); void load(); } catch (e: any) { toast.error(e.message); }
  };
  return (
    <Page>
      <Link to="/contests" className="mb-4 inline-flex items-center gap-1 text-sm text-ink-400 hover:text-ink-200"><ArrowLeft className="size-4" /> Contests</Link>
      <div className="flex flex-wrap items-start gap-6 rounded-2xl border border-ink-800 bg-ink-900/70 p-6">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2"><Badge className={STATUS_BADGE[c.status]}>{c.status === 'running' ? 'live' : c.status}</Badge>{c.frozen && <Badge className="border-sky-500/40 text-sky-300"><Snowflake className="size-3" /> frozen</Badge>}</div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink-100">{c.title}</h1>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-400">
            <span className="flex items-center gap-1"><Clock className="size-3.5" /> {Math.round((c.endsAt - c.startsAt) / 60_000)} min</span>
            <span className="flex items-center gap-1"><Users className="size-3.5" /> {c.participants} participants</span>
            <span>{c.penaltyMin} min penalty per rejected attempt</span>
          </div>
          {c.description && <div className="mt-3 max-w-2xl"><Markdown>{c.description}</Markdown></div>}
        </div>
        <div className="text-right">
          {c.status !== 'ended' ? (
            <>
              <div className="text-xs text-ink-400">{c.status === 'upcoming' ? 'Starts in' : 'Ends in'}</div>
              <div className="font-mono text-3xl font-semibold tabular-nums text-ink-100" role="timer">{longDuration(left)}</div>
            </>
          ) : <div className="text-sm text-ink-400">Finished {new Date(c.endsAt).toLocaleDateString()}</div>}
          {c.status !== 'ended' && !c.joined && <Button variant="primary" className="mt-3" onClick={join}>{c.status === 'upcoming' ? 'Register' : 'Join now'}</Button>}
          {c.joined && c.status !== 'ended' && <div className="mt-3 flex items-center justify-end gap-1 text-sm text-emerald-300"><Check className="size-4" /> Registered</div>}
        </div>
      </div>

      <div className="mt-6 mb-3 flex items-center gap-3">
        <Tabs value={tab} onChange={setTab} tabs={[{ id: 'problems', label: 'Problems' }, { id: 'standings', label: 'Standings' }]} />
        {tab === 'standings' && <span className={cx('flex items-center gap-1.5 text-xs', live ? 'text-emerald-300' : 'text-ink-500')}><Radio className={cx('size-3.5', live && c.status === 'running' && 'animate-ember')} /> {live ? 'live' : 'connecting…'}</span>}
      </div>
      {tab === 'problems' ? (
        c.status === 'upcoming' && !c.canManage ? (
          <Card className="p-10 text-center"><Lock className="mx-auto size-8 text-ink-500" /><p className="mt-3 text-ink-300">Problems are revealed when the contest starts.</p></Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {d.problems.map((p) => {
              const st = standings?.problems.find((x) => x.questionId === p.id);
              const to = c.status === 'running' ? `/contests/${slug}/${p.label}` : `/contests/${slug}/${p.label}`;
              return (
                <Link key={p.id} to={to} className={cx('group flex items-center gap-4 rounded-xl border bg-ink-900/70 p-4 transition hover:border-ink-600', p.mine === 'solved' ? 'border-emerald-500/40' : p.mine === 'attempted' ? 'border-rose-500/30' : 'border-ink-800')}>
                  <span className={cx('grid size-11 place-items-center rounded-lg text-lg font-semibold', p.mine === 'solved' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-ink-800 text-ink-200')}>{p.mine === 'solved' ? <Check className="size-5" /> : p.label}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-ink-100 group-hover:text-ember-200">{p.label}. {p.title}</div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-ink-400"><Difficulty d={p.difficulty} />{st && <span>{st.solvedBy} solved · {st.triedBy} tried</span>}</div>
                  </div>
                </Link>
              );
            })}
          </div>
        )
      ) : standings ? (
        <>
          {standings.frozen && <p className="mb-2 flex items-center gap-1.5 text-xs text-sky-300"><Snowflake className="size-3.5" /> The scoreboard is frozen for the final {c.freezeMin} minutes — results after the freeze show as “?”.</p>}
          <StandingsTable s={standings} me={user?.id} />
          <p className="mt-2 text-xs text-ink-500">+n: accepted after n rejected attempts, with the minute of acceptance · −n: rejected attempts · ★ first to solve.</p>
        </>
      ) : <PageLoader />}
    </Page>
  );
}
