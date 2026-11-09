import { Flame, Trophy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Heatmap, Radar } from '../components/charts';
import { Page, PageHeader } from '../components/Layout';
import { Card, Difficulty, ErrorBox, PageLoader, Stat, VerdictBadge } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ago, DIFFICULTY_CLS, ms } from '../lib/format';

interface Stats {
  points: number; rank: number; ranked: number; streak: number;
  solved: { id: number; slug: string; title: string; difficulty: 'easy' | 'medium' | 'hard' }[];
  totals: Record<string, number>;
  skills: { tag: string; total: number; solved: number }[];
  activity: { day: string; n: number }[];
  languages: { language: string; n: number }[];
  recent: { id: number; verdict: any; language: string; created_at: number; time_ms: number; title: string; slug: string }[];
}

export function Dashboard() {
  const { user } = useAuth();
  const [s, setS] = useState<Stats | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api.get<Stats>('/api/me/stats').then(setS).catch((e) => setErr(e.message)); }, []);
  if (err) return <Page><ErrorBox error={err} /></Page>;
  if (!s) return <PageLoader />;
  const by = (d: string) => s.solved.filter((q) => q.difficulty === d).length;
  return (
    <Page>
      <PageHeader title={`Hi, ${user?.name.split(' ')[0]}`} subtitle="Your practice progress" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Points" value={s.points} sub="easy 10 · medium 25 · hard 50" />
        <Stat label="Global rank" value={<span className="flex items-center gap-2"><Trophy className="size-5 text-amber-300" />#{s.rank}</span>} sub={`of ${s.ranked} ranked`} />
        <Stat label="Solved" value={s.solved.length} sub={['easy', 'medium', 'hard'].map((d) => `${by(d)}/${s.totals[d] ?? 0} ${d}`).join(' · ')} />
        <Stat label="Streak" value={<span className="flex items-center gap-2"><Flame className="size-5 text-ember-400" />{s.streak} day{s.streak === 1 ? '' : 's'}</span>} />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold text-ink-200">Activity</h2>
          <Heatmap days={s.activity} />
          <h2 className="mt-6 mb-2 text-sm font-semibold text-ink-200">Difficulty breakdown</h2>
          <div className="space-y-2">
            {(['easy', 'medium', 'hard'] as const).map((d) => {
              const total = s.totals[d] ?? 0;
              return (
                <div key={d} className="flex items-center gap-3 text-xs">
                  <span className={`w-14 capitalize ${DIFFICULTY_CLS[d]}`}>{d}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-ink-800"><div className="h-full rounded-full bg-gradient-to-r from-amber-400 to-ember-500" style={{ width: `${total ? (by(d) / total) * 100 : 0}%` }} /></div>
                  <span className="w-12 text-right tabular-nums text-ink-400">{by(d)}/{total}</span>
                </div>
              );
            })}
          </div>
        </Card>
        <Card className="flex flex-col items-center p-5">
          <h2 className="mb-2 self-start text-sm font-semibold text-ink-200">Skill coverage</h2>
          <Radar data={s.skills.map((k) => ({ label: k.tag, value: k.total ? k.solved / k.total : 0 }))} />
          {s.languages.length > 0 && <div className="mt-2 flex flex-wrap justify-center gap-1.5 text-xs text-ink-400">{s.languages.map((l) => <span key={l.language} className="rounded bg-ink-800 px-1.5 py-0.5">{l.language} · {l.n}</span>)}</div>}
        </Card>
      </div>
      <Card className="mt-4 p-5">
        <h2 className="mb-3 text-sm font-semibold text-ink-200">Recent submissions</h2>
        {s.recent.length ? (
          <ul className="divide-y divide-ink-800">
            {s.recent.map((r) => (
              <li key={r.id} className="flex items-center gap-3 py-2 text-sm">
                <VerdictBadge verdict={r.verdict} />
                <Link to={`/problems/${r.slug}`} className="text-ink-100 hover:text-ember-300">{r.title}</Link>
                <span className="text-xs text-ink-500">{r.language} · {ms(r.time_ms)}</span>
                <span className="ml-auto text-xs text-ink-500">{ago(r.created_at)}</span>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-ink-400">Nothing yet — <Link to="/problems" className="text-ember-400">pick a problem</Link>.</p>}
      </Card>
      {s.solved.length > 0 && (
        <Card className="mt-4 p-5">
          <h2 className="mb-3 text-sm font-semibold text-ink-200">Solved</h2>
          <div className="flex flex-wrap gap-2">{s.solved.map((q) => <Link key={q.id} to={`/problems/${q.slug}`} className="flex items-center gap-2 rounded-lg border border-ink-800 px-2.5 py-1.5 text-xs text-ink-200 hover:border-ink-600">{q.title} <Difficulty d={q.difficulty} /></Link>)}</div>
        </Card>
      )}
    </Page>
  );
}
