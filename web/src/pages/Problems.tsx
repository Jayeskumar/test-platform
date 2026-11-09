import { CheckCircle2, Circle, CircleDot, Code2, Database, ListChecks, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Page, PageHeader } from '../components/Layout';
import { Badge, Difficulty, ErrorBox, Input, ListSkeleton, Select } from '../components/ui';
import { api } from '../lib/api';
import { cx } from '../lib/format';
import type { Difficulty as D } from '../lib/types';

interface Row { id: number; slug: string; type: 'coding' | 'sql' | 'mcq'; title: string; difficulty: D; tags: string[]; points: number; acceptance: number | null; submissions: number; status: 'solved' | 'attempted' | 'todo' }

const TYPE_ICON = { coding: Code2, sql: Database, mcq: ListChecks };

export function Problems() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [diff, setDiff] = useState('');
  const [type, setType] = useState('');
  const [tag, setTag] = useState('');
  useEffect(() => { api.get<{ problems: Row[] }>('/api/problems').then((r) => setRows(r.problems)).catch((e) => setErr(e.message)); }, []);
  const tags = useMemo(() => [...new Set((rows ?? []).flatMap((r) => r.tags))].sort(), [rows]);
  const shown = (rows ?? []).filter((r) =>
    (!q || r.title.toLowerCase().includes(q.toLowerCase())) && (!diff || r.difficulty === diff) && (!type || r.type === type) && (!tag || r.tags.includes(tag)));
  const solved = rows?.filter((r) => r.status === 'solved').length ?? 0;
  return (
    <Page>
      <PageHeader title="Practice" subtitle={rows ? `${rows.length} problems · ${solved} solved` : undefined} />
      <div className="mb-4 flex flex-wrap gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-ink-500" />
          <Input placeholder="Search problems" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" aria-label="Search problems" />
        </div>
        <Select value={diff} onChange={(e) => setDiff(e.target.value)} className="w-auto" aria-label="Difficulty"><option value="">All difficulties</option><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option></Select>
        <Select value={type} onChange={(e) => setType(e.target.value)} className="w-auto" aria-label="Type"><option value="">All types</option><option value="coding">Coding</option><option value="sql">SQL</option><option value="mcq">Multiple choice</option></Select>
        <Select value={tag} onChange={(e) => setTag(e.target.value)} className="w-auto" aria-label="Topic"><option value="">All topics</option>{tags.map((t) => <option key={t}>{t}</option>)}</Select>
      </div>
      <ErrorBox error={err} />
      {!rows && !err ? <ListSkeleton rows={10} /> : (
        <div className="overflow-hidden rounded-xl border border-ink-800">
          <table className="w-full text-sm">
            <thead className="bg-ink-900 text-left text-xs text-ink-400">
              <tr>
                <th className="w-10 px-4 py-2.5" aria-label="Status" />
                <th className="px-2 py-2.5 font-medium">Title</th>
                <th className="hidden px-2 py-2.5 font-medium md:table-cell">Topics</th>
                <th className="px-2 py-2.5 font-medium">Difficulty</th>
                <th className="hidden px-4 py-2.5 text-right font-medium sm:table-cell">Acceptance</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const Icon = TYPE_ICON[r.type];
                return (
                  <tr key={r.id} className="border-t border-ink-800/80 hover:bg-ink-900/70">
                    <td className="px-4 py-3">
                      {r.status === 'solved' ? <CheckCircle2 className="size-4 text-emerald-400" aria-label="Solved" /> : r.status === 'attempted' ? <CircleDot className="size-4 text-amber-400" aria-label="Attempted" /> : <Circle className="size-4 text-ink-700" aria-label="Not started" />}
                    </td>
                    <td className="px-2 py-3">
                      <Link to={`/problems/${r.slug}`} className="flex items-center gap-2 font-medium text-ink-100 hover:text-ember-300">
                        <Icon className="size-3.5 text-ink-500" />{r.title}
                      </Link>
                    </td>
                    <td className="hidden px-2 py-3 md:table-cell"><div className="flex flex-wrap gap-1">{r.tags.slice(0, 3).map((t) => <Badge key={t}>{t}</Badge>)}</div></td>
                    <td className="px-2 py-3"><Difficulty d={r.difficulty} /></td>
                    <td className={cx('hidden px-4 py-3 text-right tabular-nums sm:table-cell', r.acceptance == null ? 'text-ink-500' : 'text-ink-300')}>{r.type === 'mcq' ? '—' : r.acceptance == null ? 'new' : `${r.acceptance}%`}</td>
                  </tr>
                );
              })}
              {!shown.length && <tr><td colSpan={5} className="px-4 py-10 text-center text-sm text-ink-400">No problems match these filters.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </Page>
  );
}
