import { AlertTriangle, ArrowDown, ArrowUp, Check, Columns3, Copy, Download, Pencil, Search, ShieldAlert, UserPlus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Histogram } from '../components/charts';
import { Page, PageHeader } from '../components/Layout';
import { Badge, Button, Card, Difficulty, Empty, ErrorBox, Input, Label, PageLoader, Stat, Textarea } from '../components/ui';
import { useToast } from '../lib/toast';
import { api } from '../lib/api';
import { ago, cx, duration, pct } from '../lib/format';

export type Decision = 'advance' | 'hold' | 'reject' | null;
interface Attempt {
  id: number; name: string; email: string; status: 'invited' | 'in_progress' | 'submitted'; token: string;
  startedAt: number | null; submittedAt: number | null; score: number | null; maxScore: number | null;
  integrity: { score: number; level: string; flags: number } | null; durationMs: number | null;
  decision: Decision; notes: string; scores: Record<number, number>; questionIds: number[] | null;
}
interface Detail {
  assessment: { id: number; title: string; description: string; durationMin: number; status: string };
  questions: { id: number; title: string; type: string; difficulty: 'easy' | 'medium' | 'hard'; points: number; pool: string | null }[];
  perQuestion: { questionId: number; avgPct: number; candidates: number }[];
  attempts: Attempt[];
}
interface Match { questionTitle: string; aLabel: string; bLabel: string; similarity: number; reference: boolean; a: string; b: string }

export const linkFor = (token: string) => `${window.location.origin}/t/${token}`;

function CopyLink({ token }: { token: string }) {
  const [ok, setOk] = useState(false);
  const toast = useToast();
  return (
    <button onClick={async () => { try { await navigator.clipboard.writeText(linkFor(token)); setOk(true); toast.success('Invite link copied'); setTimeout(() => setOk(false), 1500); } catch { toast.error('Could not access the clipboard — copy the link from the tooltip.'); } }} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-ink-400 hover:bg-ink-800 hover:text-ink-100" title={linkFor(token)}>
      {ok ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />} {ok ? 'Copied' : 'Copy link'}
    </button>
  );
}

export const INTEGRITY_CLS: Record<string, string> = { high: 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10', medium: 'text-amber-300 border-amber-500/30 bg-amber-500/10', low: 'text-rose-300 border-rose-500/30 bg-rose-500/10' };

export const DECISION: Record<'advance' | 'hold' | 'reject', { label: string; cls: string }> = {
  advance: { label: 'Advance', cls: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' },
  hold: { label: 'Hold', cls: 'border-amber-500/40 bg-amber-500/10 text-amber-300' },
  reject: { label: 'Reject', cls: 'border-rose-500/40 bg-rose-500/10 text-rose-300' },
};

type SortKey = 'score' | 'integrity' | 'time' | 'name' | 'submitted';
type Filter = 'all' | 'submitted' | 'in_progress' | 'invited' | 'flagged' | 'undecided';

function csvCell(v: unknown) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function exportCsv(d: Detail) {
  const head = ['Name', 'Email', 'Status', 'Score', 'Max score', 'Score %', 'Integrity', 'Integrity level', 'Time used (min)', 'Decision', 'Submitted at',
    ...d.questions.map((q) => `${q.title} (${q.points})`)];
  const lines = d.attempts.map((a) => [
    a.name, a.email, a.status, a.score ?? '', a.maxScore ?? '', a.score != null && a.maxScore ? pct(a.score, a.maxScore) : '',
    a.integrity?.score ?? '', a.integrity?.level ?? '', a.durationMs ? Math.round(a.durationMs / 6000) / 10 : '', a.decision ?? '',
    a.submittedAt ? new Date(a.submittedAt).toISOString() : '',
    ...d.questions.map((q) => (a.questionIds && !a.questionIds.includes(q.id) ? 'n/a' : a.scores[q.id] ?? (a.status === 'submitted' ? 0 : ''))),
  ]);
  const csv = [head, ...lines].map((r) => r.map(csvCell).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${d.assessment.title.replace(/[^\w-]+/g, '-').toLowerCase()}-results.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function CandidatesTable({ detail: d }: { detail: Detail }) {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'score', dir: -1 });
  const [picked, setPicked] = useState<number[]>([]);
  const counts = useMemo(() => ({
    all: d.attempts.length,
    submitted: d.attempts.filter((a) => a.status === 'submitted').length,
    in_progress: d.attempts.filter((a) => a.status === 'in_progress').length,
    invited: d.attempts.filter((a) => a.status === 'invited').length,
    flagged: d.attempts.filter((a) => a.integrity && a.integrity.level !== 'high').length,
    undecided: d.attempts.filter((a) => a.status === 'submitted' && !a.decision).length,
  }), [d.attempts]);
  const val = (a: Attempt, k: SortKey): number | string => {
    switch (k) {
      case 'score': return a.score != null && a.maxScore ? a.score / a.maxScore : -1;
      case 'integrity': return a.integrity?.score ?? -1;
      case 'time': return a.durationMs ?? Number.MAX_SAFE_INTEGER;
      case 'submitted': return a.submittedAt ?? 0;
      default: return (a.name || a.email).toLowerCase();
    }
  };
  const rows = d.attempts
    .filter((a) => {
      if (filter === 'flagged') return !!a.integrity && a.integrity.level !== 'high';
      if (filter === 'undecided') return a.status === 'submitted' && !a.decision;
      return filter === 'all' || a.status === filter;
    })
    .filter((a) => !q || `${a.name} ${a.email}`.toLowerCase().includes(q.toLowerCase()))
    .sort((x, y) => {
      const a = val(x, sort.key);
      const b = val(y, sort.key);
      return (a < b ? -1 : a > b ? 1 : 0) * sort.dir;
    });
  const toggleSort = (key: SortKey) => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : key === 'name' || key === 'time' ? 1 : -1 }));
  const Th = ({ k, children, right }: { k: SortKey; children: React.ReactNode; right?: boolean }) => (
    <th className={cx('px-2 py-2 font-medium', right && 'text-right')} aria-sort={sort.key === k ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
      <button onClick={() => toggleSort(k)} className={cx('inline-flex items-center gap-1 hover:text-ink-100', sort.key === k && 'text-ink-200')}>
        {children}{sort.key === k && (sort.dir === 1 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
      </button>
    </th>
  );
  const FILTERS: [Filter, string][] = [['all', 'All'], ['submitted', 'Submitted'], ['undecided', 'To review'], ['flagged', 'Flagged'], ['in_progress', 'In progress'], ['invited', 'Invited']];
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b border-ink-800 px-4 py-3">
        <h2 className="mr-auto font-semibold text-ink-100">Candidates</h2>
        <div className="relative w-full sm:w-52">
          <Search className="pointer-events-none absolute top-2 left-2.5 size-4 text-ink-500" />
          <Input placeholder="Search candidates" value={q} onChange={(e) => setQ(e.target.value)} className="h-8 py-1 pl-8 text-xs" aria-label="Search candidates" />
        </div>
        <Button size="sm" onClick={() => exportCsv(d)} disabled={!d.attempts.length} title="Download results as CSV"><Download className="size-3.5" /> CSV</Button>
      </div>
      <div className="flex gap-1 overflow-x-auto border-b border-ink-800 px-4 py-2" role="tablist" aria-label="Filter candidates">
        {FILTERS.map(([f, label]) => (
          <button key={f} role="tab" aria-selected={filter === f} onClick={() => setFilter(f)} className={cx('flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium', filter === f ? 'bg-ink-700 text-ink-100' : 'text-ink-400 hover:text-ink-100')}>
            {label}<span className={cx('rounded px-1 tabular-nums', filter === f ? 'bg-ink-600 text-ink-100' : 'bg-ink-800 text-ink-400')}>{counts[f]}</span>
          </button>
        ))}
      </div>
      {picked.length > 0 && (
        <div className="flex items-center gap-3 border-b border-ink-800 bg-ember-500/5 px-4 py-2 text-xs">
          <span className="text-ink-200">{picked.length} selected</span>
          <Button size="sm" variant="primary" disabled={picked.length < 2} onClick={() => nav(`/hiring/${d.assessment.id}/compare?ids=${picked.join(',')}`)}><Columns3 className="size-3.5" /> Compare side by side</Button>
          <button onClick={() => setPicked([])} className="text-ink-400 hover:text-ink-100">Clear</button>
          {picked.length >= 4 && <span className="text-ink-500">up to 4</span>}
        </div>
      )}
      {!d.attempts.length ? <div className="p-5"><Empty title="No candidates yet">Invite people with the form on the right.</Empty></div> : !rows.length ? <div className="p-5"><Empty title="Nobody matches">Try another filter or search.</Empty></div> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-ink-400">
              <tr>
                <th className="w-8 py-2 pl-4"><span className="sr-only">Select</span></th>
                <Th k="name">Candidate</Th>
                <th className="px-2 py-2 font-medium">Status</th>
                <Th k="score" right>Score</Th>
                <Th k="integrity">Integrity</Th>
                <Th k="time">Time</Th>
                <th className="px-2 py-2 font-medium">Decision</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => {
                const sel = picked.includes(a.id);
                const canPick = a.status !== 'invited';
                return (
                  <tr key={a.id} className={cx('border-t border-ink-800/80 hover:bg-ink-850/60', sel && 'bg-ember-500/5')}>
                    <td className="py-2.5 pl-4">
                      {canPick && <input type="checkbox" checked={sel} disabled={!sel && picked.length >= 4} onChange={() => setPicked((p) => (sel ? p.filter((x) => x !== a.id) : [...p, a.id]))} className="accent-ember-500" aria-label={`Select ${a.name || a.email}`} />}
                    </td>
                    <td className="px-2 py-2.5">
                      {a.status === 'invited' ? <div className="text-ink-200">{a.name || a.email}</div> : <Link to={`/hiring/attempts/${a.id}`} className="font-medium text-ink-100 hover:text-ember-300">{a.name || a.email}</Link>}
                      <div className="text-xs text-ink-500">{a.email}</div>
                    </td>
                    <td className="px-2 py-2.5">
                      <Badge className={cx(a.status === 'submitted' ? 'border-emerald-500/30 text-emerald-300' : a.status === 'in_progress' ? 'border-sky-500/30 text-sky-300' : 'border-ink-600 text-ink-400')}>{a.status.replace('_', ' ')}</Badge>
                      {a.submittedAt && <div className="mt-0.5 text-[11px] text-ink-500">{ago(a.submittedAt)}</div>}
                    </td>
                    <td className="px-2 py-2.5 text-right tabular-nums">
                      {a.score != null && a.maxScore ? (
                        <div className="inline-flex flex-col items-end">
                          <span className="font-semibold text-ink-100">{pct(a.score, a.maxScore)}%</span>
                          <span className="mt-0.5 h-1 w-14 overflow-hidden rounded-full bg-ink-800"><span className="block h-full rounded-full bg-ember-500" style={{ width: `${pct(a.score, a.maxScore)}%` }} /></span>
                        </div>
                      ) : <span className="text-ink-500">—</span>}
                    </td>
                    <td className="px-2 py-2.5">{a.integrity ? <Badge className={INTEGRITY_CLS[a.integrity.level]}>{a.integrity.score} · {a.integrity.level}</Badge> : <span className="text-ink-500">—</span>}</td>
                    <td className="px-2 py-2.5 text-xs text-ink-400">{a.durationMs ? duration(a.durationMs) : '—'}</td>
                    <td className="px-2 py-2.5">{a.decision ? <Badge className={DECISION[a.decision].cls}>{DECISION[a.decision].label}</Badge> : a.status === 'submitted' ? <span className="text-xs text-ink-500">to review</span> : null}</td>
                    <td className="px-4 py-2.5 text-right">{a.status === 'invited' ? <CopyLink token={a.token} /> : <Link to={`/hiring/attempts/${a.id}`} className="text-xs whitespace-nowrap text-ember-400 hover:text-ember-300">Report →</Link>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export function AssessmentDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [d, setD] = useState<Detail | null>(null);
  const [matches, setMatches] = useState<Match[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [emails, setEmails] = useState('');
  const [inviting, setInviting] = useState(false);
  const [fresh, setFresh] = useState<{ email: string; token: string }[]>([]);

  const load = useCallback(() => {
    api.get<Detail>(`/api/assessments/${id}`).then(setD).catch((e) => setErr(e.message));
    api.get<{ matches: Match[] }>(`/api/assessments/${id}/plagiarism`).then((r) => setMatches(r.matches)).catch(() => {});
  }, [id]);
  useEffect(() => {
    load();
    const t = setInterval(load, 20_000); // live-ish results while candidates are taking the test
    return () => clearInterval(t);
  }, [load]);

  const invite = async () => {
    const candidates = emails.split(/[\n,;]+/).map((l) => l.trim()).filter(Boolean).map((l) => {
      const m = l.match(/^(.*?)\s*<(.+)>$/);
      return m ? { name: m[1].replace(/"/g, ''), email: m[2] } : { email: l, name: '' };
    });
    if (!candidates.length) return;
    setInviting(true);
    setErr(null);
    try {
      const r = await api.post<{ invites: { email: string; token: string }[] }>(`/api/assessments/${id}/invites`, { candidates });
      setFresh(r.invites);
      setEmails('');
      load();
    } catch (e: any) { setErr(e.message); } finally { setInviting(false); }
  };

  if (err && !d) return <Page><ErrorBox error={err} /></Page>;
  if (!d) return <PageLoader />;
  const submitted = d.attempts.filter((a) => a.status === 'submitted');
  const pcts = submitted.map((a) => pct(a.score ?? 0, a.maxScore ?? 1));
  const median = pcts.length ? [...pcts].sort((a, b) => a - b)[Math.floor(pcts.length / 2)] : null;
  const flagged = submitted.filter((a) => a.integrity && a.integrity.level !== 'high').length;
  const candMatches = matches.filter((m) => !m.reference);
  const refMatches = matches.filter((m) => m.reference);
  return (
    <Page>
      <PageHeader
        title={d.assessment.title}
        subtitle={`${d.questions.length} questions · ${d.assessment.durationMin} minutes · ${d.assessment.status}`}
        actions={<Button onClick={() => nav(`/hiring/${id}/edit`)}><Pencil className="size-4" /> Edit</Button>}
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Candidates" value={d.attempts.length} sub={`${d.attempts.filter((a) => a.status === 'in_progress').length} in progress`} />
        <Stat label="Completed" value={submitted.length} sub={d.attempts.length ? `${pct(submitted.length, d.attempts.length)}% completion` : undefined} />
        <Stat label="Median score" value={median == null ? '—' : `${median}%`} />
        <Stat label="Integrity flags" value={<span className={flagged ? 'text-amber-300' : ''}>{flagged}</span>} sub={`${candMatches.length + refMatches.length} similarity match${candMatches.length + refMatches.length === 1 ? '' : 'es'}`} />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="p-0 lg:col-span-2">
          <CandidatesTable detail={d} />
        </Card>
        <div className="space-y-4">
          <Card className="p-5">
            <h2 className="mb-3 flex items-center gap-2 font-semibold text-ink-100"><UserPlus className="size-4 text-ember-400" /> Invite candidates</h2>
            <Label hint="one per line">Emails</Label>
            <Textarea rows={4} value={emails} onChange={(e) => setEmails(e.target.value)} placeholder={'jane@company.com\nSam Lee <sam@example.com>'} />
            <Button variant="primary" className="mt-3 w-full" onClick={invite} loading={inviting} disabled={!emails.trim() || d.assessment.status !== 'active'}>Create invite links</Button>
            {d.assessment.status !== 'active' && <p className="mt-2 text-xs text-amber-300">Set the assessment to active to invite candidates.</p>}
            <ErrorBox error={err} />
            {fresh.length > 0 && (
              <div className="mt-3 space-y-1.5 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
                <div className="text-xs text-emerald-300">Share these private links with each candidate:</div>
                {fresh.map((f) => (
                  <div key={f.token} className="flex items-center gap-2 text-xs"><span className="min-w-0 flex-1 truncate text-ink-200">{f.email}</span><CopyLink token={f.token} /></div>
                ))}
              </div>
            )}
          </Card>
          <Card className="p-5">
            <h2 className="mb-3 font-semibold text-ink-100">Score distribution</h2>
            {pcts.length ? <Histogram values={pcts} /> : <p className="text-sm text-ink-400">Appears after the first submission.</p>}
          </Card>
          <Card className="p-5">
            <h2 className="mb-3 font-semibold text-ink-100">Questions</h2>
            <ul className="space-y-2.5">
              {d.questions.map((q) => {
                const pq = d.perQuestion.find((p) => p.questionId === q.id);
                const avg = pq?.avgPct ?? 0;
                return (
                  <li key={q.id} className="text-sm">
                    <div className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate text-ink-200">{q.title}</span>{q.pool && <span className="rounded bg-ember-500/10 px-1 text-[10px] text-ember-200" title={`Pool ${q.pool}: drawn per candidate`}>{q.pool}</span>}<Difficulty d={q.difficulty} /><span className="text-xs text-ink-500">{q.points}p</span></div>
                    <div className="mt-1 flex items-center gap-2"><div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-800"><div className="h-full bg-ember-500" style={{ width: `${avg}%` }} /></div><span className="w-9 text-right text-xs tabular-nums text-ink-400" title={q.pool ? `${pq?.candidates ?? 0} candidates received this question` : undefined}>{pq?.candidates ? `${avg}%` : '—'}</span></div>
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>
      </div>
      {matches.length > 0 && (
        <Card className="mt-4 p-5">
          <h2 className="mb-1 flex items-center gap-2 font-semibold text-ink-100"><ShieldAlert className="size-4 text-rose-400" /> Similarity matches</h2>
          <p className="mb-3 text-xs text-ink-400">Winnowing fingerprints over normalized code, so renamed variables and reformatting don’t hide a match. Open each report to see who pasted and who typed.</p>
          <ul className="divide-y divide-ink-800">
            {matches.map((m, i) => (
              <li key={i} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                <AlertTriangle className={cx('size-4', m.similarity >= 0.9 ? 'text-rose-400' : 'text-amber-400')} />
                <span className="font-semibold tabular-nums text-ink-100">{Math.round(m.similarity * 100)}%</span>
                <span className="text-ink-200">{m.aLabel}</span><span className="text-ink-500">↔</span><span className={m.reference ? 'text-amber-200' : 'text-ink-200'}>{m.bLabel}</span>
                <span className="ml-auto text-xs text-ink-400">{m.questionTitle}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </Page>
  );
}
