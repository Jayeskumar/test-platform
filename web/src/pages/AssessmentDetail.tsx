import { AlertTriangle, Check, Copy, Pencil, ShieldAlert, UserPlus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Histogram } from '../components/charts';
import { Page, PageHeader } from '../components/Layout';
import { Badge, Button, Card, Difficulty, Empty, ErrorBox, Label, PageLoader, Stat, Textarea } from '../components/ui';
import { api } from '../lib/api';
import { ago, cx, duration, pct } from '../lib/format';

interface Attempt { id: number; name: string; email: string; status: 'invited' | 'in_progress' | 'submitted'; token: string; startedAt: number | null; submittedAt: number | null; score: number | null; maxScore: number | null; integrity: { score: number; level: string; flags: number } | null; durationMs: number | null }
interface Detail {
  assessment: { id: number; title: string; description: string; durationMin: number; status: string };
  questions: { id: number; title: string; type: string; difficulty: 'easy' | 'medium' | 'hard'; points: number }[];
  perQuestion: { questionId: number; avgPct: number }[];
  attempts: Attempt[];
}
interface Match { questionTitle: string; aLabel: string; bLabel: string; similarity: number; reference: boolean; a: string; b: string }

export const linkFor = (token: string) => `${window.location.origin}/t/${token}`;

function CopyLink({ token }: { token: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button onClick={async () => { try { await navigator.clipboard.writeText(linkFor(token)); setOk(true); setTimeout(() => setOk(false), 1500); } catch { /* clipboard unavailable */ } }} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-ink-400 hover:bg-ink-800 hover:text-ink-100" title={linkFor(token)}>
      {ok ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />} {ok ? 'Copied' : 'Copy link'}
    </button>
  );
}

export const INTEGRITY_CLS: Record<string, string> = { high: 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10', medium: 'text-amber-300 border-amber-500/30 bg-amber-500/10', low: 'text-rose-300 border-rose-500/30 bg-rose-500/10' };

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
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Candidates" value={d.attempts.length} sub={`${d.attempts.filter((a) => a.status === 'in_progress').length} in progress`} />
        <Stat label="Completed" value={submitted.length} sub={d.attempts.length ? `${pct(submitted.length, d.attempts.length)}% completion` : undefined} />
        <Stat label="Median score" value={median == null ? '—' : `${median}%`} />
        <Stat label="Integrity flags" value={<span className={flagged ? 'text-amber-300' : ''}>{flagged}</span>} sub={`${candMatches.length + refMatches.length} similarity match${candMatches.length + refMatches.length === 1 ? '' : 'es'}`} />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="p-0 lg:col-span-2">
          <div className="flex items-center justify-between border-b border-ink-800 px-5 py-3"><h2 className="font-semibold text-ink-100">Candidates</h2><span className="text-xs text-ink-500">ranked by score · refreshes automatically</span></div>
          {!d.attempts.length ? <div className="p-5"><Empty title="No candidates yet">Invite people with the form on the right.</Empty></div> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-ink-400"><tr><th className="px-5 py-2 font-medium">Candidate</th><th className="px-2 py-2 font-medium">Status</th><th className="px-2 py-2 text-right font-medium">Score</th><th className="px-2 py-2 font-medium">Integrity</th><th className="px-2 py-2 font-medium">Time</th><th className="px-5 py-2" /></tr></thead>
                <tbody>
                  {d.attempts.map((a) => (
                    <tr key={a.id} className="border-t border-ink-800/80 hover:bg-ink-850/60">
                      <td className="px-5 py-2.5">
                        {a.status === 'invited' ? <div className="text-ink-200">{a.name || a.email}</div> : <Link to={`/hiring/attempts/${a.id}`} className="font-medium text-ink-100 hover:text-ember-300">{a.name || a.email}</Link>}
                        <div className="text-xs text-ink-500">{a.email}</div>
                      </td>
                      <td className="px-2 py-2.5">
                        <Badge className={cx(a.status === 'submitted' ? 'border-emerald-500/30 text-emerald-300' : a.status === 'in_progress' ? 'border-sky-500/30 text-sky-300' : 'border-ink-600 text-ink-400')}>{a.status.replace('_', ' ')}</Badge>
                        {a.submittedAt && <div className="mt-0.5 text-[11px] text-ink-500">{ago(a.submittedAt)}</div>}
                      </td>
                      <td className="px-2 py-2.5 text-right tabular-nums">
                        {a.score != null && a.maxScore ? <><div className="font-semibold text-ink-100">{pct(a.score, a.maxScore)}%</div><div className="text-xs text-ink-500">{a.score}/{a.maxScore}</div></> : <span className="text-ink-500">—</span>}
                      </td>
                      <td className="px-2 py-2.5">{a.integrity ? <Badge className={INTEGRITY_CLS[a.integrity.level]}>{a.integrity.score} · {a.integrity.level}</Badge> : <span className="text-ink-500">—</span>}</td>
                      <td className="px-2 py-2.5 text-xs text-ink-400">{a.durationMs ? duration(a.durationMs) : '—'}</td>
                      <td className="px-5 py-2.5 text-right">{a.status === 'invited' ? <CopyLink token={a.token} /> : <Link to={`/hiring/attempts/${a.id}`} className="text-xs text-ember-400 hover:text-ember-300">Report →</Link>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
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
                const avg = d.perQuestion.find((p) => p.questionId === q.id)?.avgPct ?? 0;
                return (
                  <li key={q.id} className="text-sm">
                    <div className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate text-ink-200">{q.title}</span><Difficulty d={q.difficulty} /><span className="text-xs text-ink-500">{q.points}p</span></div>
                    <div className="mt-1 flex items-center gap-2"><div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-800"><div className="h-full bg-ember-500" style={{ width: `${avg}%` }} /></div><span className="w-9 text-right text-xs tabular-nums text-ink-400">{submitted.length ? `${avg}%` : '—'}</span></div>
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
