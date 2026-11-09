import { Medal } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Page, PageHeader } from '../components/Layout';
import { ErrorBox, PageLoader } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { cx } from '../lib/format';

export function Leaderboard() {
  const { user } = useAuth();
  const [rows, setRows] = useState<{ id: number; name: string; solved: number; points: number }[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api.get<{ leaders: any[] }>('/api/leaderboard').then((r) => setRows(r.leaders)).catch((e) => setErr(e.message)); }, []);
  const medal = ['text-amber-300', 'text-ink-200', 'text-orange-400'];
  return (
    <Page>
      <PageHeader title="Leaderboard" subtitle="Points from accepted practice solutions. Ties go to whoever got there first." />
      <ErrorBox error={err} />
      {!rows ? <PageLoader /> : (
        <div className="overflow-hidden rounded-xl border border-ink-800">
          <table className="w-full text-sm">
            <thead className="bg-ink-900 text-left text-xs text-ink-400"><tr><th className="w-16 px-4 py-2.5 font-medium">#</th><th className="px-2 py-2.5 font-medium">Name</th><th className="px-2 py-2.5 text-right font-medium">Solved</th><th className="px-4 py-2.5 text-right font-medium">Points</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id} className={cx('border-t border-ink-800/80', user?.id === r.id && 'bg-ember-500/10')}>
                  <td className="px-4 py-2.5 tabular-nums text-ink-400">{i < 3 ? <Medal className={cx('size-4', medal[i])} aria-label={`Rank ${i + 1}`} /> : i + 1}</td>
                  <td className="px-2 py-2.5 text-ink-100">{r.name}{user?.id === r.id && <span className="ml-2 text-xs text-ember-300">you</span>}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums text-ink-300">{r.solved}</td>
                  <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-ink-100">{r.points}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Page>
  );
}
