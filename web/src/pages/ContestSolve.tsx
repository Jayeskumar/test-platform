import { ArrowLeft, Clock } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ErrorBox, PageLoader } from '../components/ui';
import { Workspace } from '../components/Workspace';
import { api } from '../lib/api';
import { cx } from '../lib/format';
import type { Problem } from '../lib/types';
import { longDuration, useCountdown } from '../lib/useCountdown';

export function ContestSolve() {
  const { slug = '', label = '' } = useParams();
  const [problem, setProblem] = useState<Problem | null>(null);
  const [info, setInfo] = useState<{ title: string; endsAt: number; status: string; serverNow: number; labels: string[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setProblem(null);
    api.get<{ problem: Problem }>(`/api/contests/${slug}/problems/${label}`).then((r) => setProblem(r.problem)).catch((e) => setErr(e.message));
    api.get<any>(`/api/contests/${slug}`).then((r) => setInfo({ title: r.contest.title, endsAt: r.contest.endsAt, status: r.contest.status, serverNow: r.serverNow, labels: r.problems.map((p: any) => p.label) })).catch(() => {});
  }, [slug, label]);
  const left = useCountdown(info?.endsAt ?? null, info?.serverNow);
  if (err) return <div className="p-8"><ErrorBox error={err} /></div>;
  if (!problem || !info) return <PageLoader />;
  const ended = info.status === 'ended' || left <= 0;
  return (
    <div className="lg:h-[calc(100vh-3.5rem)]">
      {ended && <div className="border-b border-ink-800 bg-ink-850 px-4 py-1.5 text-center text-xs text-ink-300">This contest has ended — you can read the problem, but submissions no longer count. Practice it any time from the problem list.</div>}
      <Workspace
        key={`${slug}-${label}`}
        problem={problem}
        contestSlug={ended ? undefined : slug}
        storageKey={`contest:${slug}:${label}`}
        headerExtra={(
          <div className="flex items-center gap-2 text-xs">
            <Link to={`/contests/${slug}`} className="flex items-center gap-1 text-ink-400 hover:text-ink-100"><ArrowLeft className="size-3.5" /> {info.title}</Link>
            <span className="flex items-center gap-0.5">
              {info.labels.map((l) => <Link key={l} to={`/contests/${slug}/${l}`} className={cx('grid size-6 place-items-center rounded font-semibold', l === label.toUpperCase() ? 'bg-ember-500 text-on-accent' : 'text-ink-400 hover:bg-ink-800 hover:text-ink-100')}>{l}</Link>)}
            </span>
            {!ended && <span className={cx('flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono tabular-nums', left < 10 * 60_000 ? 'bg-rose-500/15 text-rose-300' : 'bg-ink-800 text-ink-200')} role="timer"><Clock className="size-3" />{longDuration(left)}</span>}
          </div>
        )}
      />
    </div>
  );
}
