import { ArrowLeft, Crown, ExternalLink } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ScoreRing } from '../components/charts';
import { Page, PageHeader } from '../components/Layout';
import { Badge, Card, ErrorBox, PageLoader, VerdictBadge } from '../components/ui';
import { api } from '../lib/api';
import { cx, duration, pct } from '../lib/format';
import { DECISION, type Decision, INTEGRITY_CLS } from './AssessmentDetail';

interface Data {
  assessment: { id: number; title: string; durationMin: number };
  questions: { id: number; title: string; type: string; points: number; pool: string | null }[];
  candidates: {
    id: number; name: string; email: string; score: number | null; maxScore: number | null; durationMs: number | null; decision: Decision;
    integrity: { score: number; level: string; flags: string[]; counts: Record<string, number> } | null;
    questions: { questionId: number; drawn: boolean; score?: number; verdict?: any; passed?: number | null; total?: number | null; language?: string | null; complexity?: { estimate: string; meetsTarget: boolean } | null }[];
  }[];
}

export function Compare() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api.get<Data>(`/api/assessments/${id}/compare?ids=${params.get('ids') ?? ''}`).then(setD).catch((e) => setErr(e.message)); }, [id, params]);
  if (err) return <Page><ErrorBox error={err} /></Page>;
  if (!d) return <PageLoader />;
  const cols = d.candidates;
  const best = (qid: number) => Math.max(...cols.map((c) => c.questions.find((q) => q.questionId === qid)?.score ?? -1));
  const topScore = Math.max(...cols.map((c) => (c.maxScore ? (c.score ?? 0) / c.maxScore : 0)));
  const grid = { gridTemplateColumns: `minmax(170px, 1.1fr) repeat(${cols.length}, minmax(180px, 1fr))` };
  return (
    <Page wide>
      <Link to={`/hiring/${d.assessment.id}`} className="mb-4 inline-flex items-center gap-1 text-sm text-ink-400 hover:text-ink-200"><ArrowLeft className="size-4" /> {d.assessment.title}</Link>
      <PageHeader title="Compare candidates" subtitle={`${cols.length} candidates side by side`} />
      <Card className="overflow-x-auto p-0">
        <div className="min-w-fit">
          {/* Header */}
          <div className="grid border-b border-ink-800" style={grid}>
            <div className="px-4 py-4 text-xs text-ink-500">Candidate</div>
            {cols.map((c) => {
              const p = c.maxScore ? pct(c.score ?? 0, c.maxScore) : 0;
              const leader = c.maxScore && (c.score ?? 0) / c.maxScore === topScore && cols.length > 1;
              return (
                <div key={c.id} className="border-l border-ink-800 px-4 py-4">
                  <div className="flex items-center gap-3">
                    <ScoreRing value={p} size={54} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 truncate font-semibold text-ink-100">{c.name || c.email}{leader && <Crown className="size-3.5 text-amber-300" aria-label="Highest score" />}</div>
                      <Link to={`/hiring/attempts/${c.id}`} className="inline-flex items-center gap-1 text-xs text-ember-400 hover:text-ember-300">Full report <ExternalLink className="size-3" /></Link>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {/* Summary rows */}
          {[
            ['Score', (c: Data['candidates'][0]) => <span className="tabular-nums text-ink-100">{c.score ?? 0} / {c.maxScore ?? '—'}</span>],
            ['Integrity', (c: Data['candidates'][0]) => (c.integrity ? <Badge className={INTEGRITY_CLS[c.integrity.level]}>{c.integrity.score} · {c.integrity.level}</Badge> : '—')],
            ['Decision', (c: Data['candidates'][0]) => (c.decision ? <Badge className={DECISION[c.decision].cls}>{DECISION[c.decision].label}</Badge> : <span className="text-xs text-ink-500">not decided</span>)],
            ['Time used', (c: Data['candidates'][0]) => <span className="text-ink-300">{c.durationMs ? `${duration(c.durationMs)} of ${d.assessment.durationMin}:00` : '—'}</span>],
            ['Tab switches · pastes', (c: Data['candidates'][0]) => <span className="tabular-nums text-ink-300">{c.integrity?.counts.tab_hidden ?? 0} · {c.integrity?.counts.paste ?? 0}</span>],
          ].map(([label, render]: any) => (
            <div key={label} className="grid border-b border-ink-800 text-sm" style={grid}>
              <div className="px-4 py-2.5 text-xs text-ink-400">{label}</div>
              {cols.map((c) => <div key={c.id} className="border-l border-ink-800 px-4 py-2.5">{render(c)}</div>)}
            </div>
          ))}
          {/* Questions */}
          <div className="border-b border-ink-800 bg-ink-850/60 px-4 py-2 text-[11px] font-medium tracking-wide text-ink-400 uppercase">Questions</div>
          {d.questions.map((q) => {
            const top = best(q.id);
            return (
              <div key={q.id} className="grid border-b border-ink-800 text-sm" style={grid}>
                <div className="px-4 py-3">
                  <div className="text-ink-100">{q.title}</div>
                  <div className="text-xs text-ink-500">{q.type} · {q.points} pts{q.pool && ` · pool ${q.pool}`}</div>
                </div>
                {cols.map((c) => {
                  const a = c.questions.find((x) => x.questionId === q.id);
                  if (!a?.drawn) return <div key={c.id} className="border-l border-ink-800 px-4 py-3 text-xs text-ink-500">not drawn</div>;
                  const p = pct(a.score ?? 0, q.points);
                  return (
                    <div key={c.id} className={cx('border-l border-ink-800 px-4 py-3', top > 0 && a.score === top && cols.length > 1 && 'bg-emerald-500/5')}>
                      <div className="flex items-center gap-2">
                        <span className="w-14 font-semibold tabular-nums text-ink-100">{Math.round((a.score ?? 0) * 10) / 10}</span>
                        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-800"><span className={cx('block h-full rounded-full', p >= 100 ? 'bg-emerald-500' : p > 0 ? 'bg-amber-500' : 'bg-rose-500')} style={{ width: `${Math.max(p, 3)}%` }} /></span>
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-400">
                        {a.verdict && <VerdictBadge verdict={a.verdict} />}
                        {a.total != null && <span>{a.passed}/{a.total}</span>}
                        {a.language && q.type !== 'mcq' && <span>{a.language}</span>}
                        {a.complexity && <span className={a.complexity.meetsTarget ? 'font-mono text-emerald-300' : 'font-mono text-rose-300'}>{a.complexity.estimate}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
          {/* Flags */}
          <div className="grid text-sm" style={grid}>
            <div className="px-4 py-3 text-xs text-ink-400">Integrity flags</div>
            {cols.map((c) => (
              <div key={c.id} className="border-l border-ink-800 px-4 py-3">
                {c.integrity?.flags.length ? (
                  <ul className="space-y-1 text-xs text-ink-300">{c.integrity.flags.slice(0, 5).map((f, i) => <li key={i} className="flex gap-1.5"><span className="text-amber-400">▲</span>{f}</li>)}{c.integrity.flags.length > 5 && <li className="text-ink-500">+{c.integrity.flags.length - 5} more</li>}</ul>
                ) : <span className="text-xs text-emerald-300">None</span>}
              </div>
            ))}
          </div>
        </div>
      </Card>
    </Page>
  );
}
