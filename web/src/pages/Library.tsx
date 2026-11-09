import { Code2, Database, ListChecks, Plus, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Page, PageHeader } from '../components/Layout';
import { Badge, Button, Difficulty, ErrorBox, Input, ListSkeleton, Select } from '../components/ui';
import { api } from '../lib/api';
import { ago } from '../lib/format';

interface Row { id: number; slug: string; type: 'coding' | 'sql' | 'mcq'; title: string; difficulty: 'easy' | 'medium' | 'hard'; tags: string[]; visibility: string; updated_at: number; author: string | null; tests: number; used_in: number }
const ICON = { coding: Code2, sql: Database, mcq: ListChecks };

export function Library() {
  const nav = useNavigate();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  useEffect(() => { api.get<{ questions: Row[] }>('/api/library/questions').then((r) => setRows(r.questions)).catch((e) => setErr(e.message)); }, []);
  const shown = (rows ?? []).filter((r) => (!q || `${r.title} ${r.tags.join(' ')}`.toLowerCase().includes(q.toLowerCase())) && (!type || r.type === type));
  return (
    <Page>
      <PageHeader title="Question library" subtitle="Public questions also appear in practice; private ones are only used in assessments." actions={<Button variant="primary" onClick={() => nav('/library/new')}><Plus className="size-4" /> New question</Button>} />
      <div className="mb-4 flex gap-2">
        <div className="relative flex-1"><Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-ink-500" /><Input placeholder="Search by title or topic" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" aria-label="Search" /></div>
        <Select value={type} onChange={(e) => setType(e.target.value)} className="w-auto" aria-label="Type"><option value="">All types</option><option value="coding">Coding</option><option value="sql">SQL</option><option value="mcq">MCQ</option></Select>
      </div>
      <ErrorBox error={err} />
      {!rows ? <ListSkeleton rows={8} /> : (
        <div className="overflow-hidden rounded-xl border border-ink-800">
          <table className="w-full text-sm">
            <thead className="bg-ink-900 text-left text-xs text-ink-400"><tr><th className="px-4 py-2.5 font-medium">Question</th><th className="px-2 py-2.5 font-medium">Difficulty</th><th className="hidden px-2 py-2.5 font-medium md:table-cell">Tests</th><th className="hidden px-2 py-2.5 font-medium md:table-cell">Used in</th><th className="px-2 py-2.5 font-medium">Visibility</th><th className="hidden px-4 py-2.5 text-right font-medium sm:table-cell">Updated</th></tr></thead>
            <tbody>
              {shown.map((r) => {
                const Icon = ICON[r.type];
                return (
                  <tr key={r.id} className="border-t border-ink-800/80 hover:bg-ink-900/70">
                    <td className="px-4 py-2.5">
                      <Link to={`/library/${r.id}`} className="flex items-center gap-2 font-medium text-ink-100 hover:text-ember-300"><Icon className="size-3.5 text-ink-500" />{r.title}</Link>
                      <div className="mt-0.5 flex flex-wrap gap-1">{r.tags.slice(0, 4).map((t) => <Badge key={t}>{t}</Badge>)}</div>
                    </td>
                    <td className="px-2 py-2.5"><Difficulty d={r.difficulty} /></td>
                    <td className="hidden px-2 py-2.5 tabular-nums text-ink-300 md:table-cell">{r.type === 'mcq' ? '—' : r.tests}</td>
                    <td className="hidden px-2 py-2.5 tabular-nums text-ink-300 md:table-cell">{r.used_in}</td>
                    <td className="px-2 py-2.5"><Badge className={r.visibility === 'public' ? 'border-emerald-500/30 text-emerald-300' : 'border-ink-600 text-ink-400'}>{r.visibility}</Badge></td>
                    <td className="hidden px-4 py-2.5 text-right text-xs text-ink-500 sm:table-cell">{ago(r.updated_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Page>
  );
}
