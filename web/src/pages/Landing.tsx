import {
  Activity, ArrowRight, BadgeCheck, BrainCircuit, Camera, Check, CheckCircle2, ClipboardList, Code2, Database, Eye, Fingerprint, Gauge,
  History, IdCard, Laptop, Lock, Minus, Send, Shield, Shuffle, Sparkles, Timer, UserCheck, Users, Zap,
} from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ComplexityChart, ScoreRing } from '../components/charts';
import { Button, ErrorBox } from '../components/ui';
import { isStaff, useAuth } from '../lib/auth';
import { cx } from '../lib/format';

/** A static, realistic preview of a candidate report (built from the real components). */
function ProductPreview() {
  const report = {
    estimate: 'O(n)', expected: 'O(n)', meetsTarget: true, confidence: 0.9, slope: 1.02, fits: [],
    points: [20000, 40000, 80000, 160000, 320000, 640000].map((n, i) => ({ n, cpuMs: [3, 4, 6, 10, 19, 37][i], status: 'OK' })),
  };
  const rows = [
    { t: 'Pair Sum Count', v: '8/8', cx: 'O(n)' },
    { t: 'Sliding Window Rate Limiter', v: '7/7', cx: 'O(n)' },
    { t: 'Top Earners by Department', v: '3/3', cx: 'SQL' },
  ];
  return (
    <div className="relative mx-auto w-full max-w-[520px]" aria-hidden="true">
      <div className="absolute -inset-8 -z-10 rounded-[2rem] bg-[radial-gradient(closest-side,rgba(249,115,22,.22),transparent)] blur-2xl" />
      {/* IDE card behind */}
      <div className="absolute -top-14 -right-4 hidden w-[78%] rotate-[3deg] rounded-xl border border-ink-700 bg-ink-900 p-3 shadow-2xl shadow-black/20 sm:block">
        <div className="mb-2 flex items-center gap-1.5"><span className="size-2 rounded-full bg-rose-400/70" /><span className="size-2 rounded-full bg-amber-400/70" /><span className="size-2 rounded-full bg-emerald-400/70" /><span className="ml-2 text-[10px] text-ink-500">main.py</span></div>
        <pre className="font-mono text-[10.5px] leading-relaxed text-ink-300"><span className="text-fuchsia-300">for</span> x <span className="text-fuchsia-300">in</span> nums:{'\n'}    pairs += seen[target - x]{'\n'}    seen[x] += <span className="text-amber-300">1</span></pre>
        <div className="mt-2 flex flex-wrap gap-1">
          {['Test 1', 'Test 2', 'Hidden 3', 'Hidden 4', 'Hidden 5'].map((t, i) => (
            <span key={t} className={cx('flex items-center gap-1 rounded border border-ink-700 px-1.5 py-0.5 text-[9.5px] text-ink-300', i === 4 && 'animate-ember')}>
              <CheckCircle2 className="size-2.5 text-emerald-400" />{t}
            </span>
          ))}
        </div>
      </div>
      {/* Report card */}
      <div className="relative mt-10 rounded-2xl border sm:mt-24 border-ink-700 bg-ink-900/95 p-5 shadow-2xl shadow-black/25 backdrop-blur">
        <div className="flex items-center gap-4">
          <ScoreRing value={100} size={64} />
          <div className="min-w-0 flex-1">
            <div className="text-base font-semibold text-ink-100">Ada Lovelace</div>
            <div className="text-xs text-ink-400">Backend Engineer — Screening · 52 min</div>
          </div>
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-center">
            <div className="text-sm font-semibold text-emerald-300">86</div>
            <div className="text-[9px] tracking-wide text-emerald-300 uppercase">integrity</div>
          </div>
        </div>
        <ul className="mt-4 space-y-1.5">
          {rows.map((r) => (
            <li key={r.t} className="flex items-center gap-2 rounded-lg bg-ink-850 px-3 py-2 text-xs">
              <CheckCircle2 className="size-3.5 text-emerald-400" />
              <span className="flex-1 truncate text-ink-200">{r.t}</span>
              <span className="text-ink-400">{r.v}</span>
              <span className="rounded bg-emerald-500/10 px-1.5 font-mono text-[10px] text-emerald-300">{r.cx}</span>
            </li>
          ))}
        </ul>
        <div className="mt-3 rounded-lg border border-ink-800 p-2">
          <div className="mb-1 flex items-center justify-between text-[10px] text-ink-400"><span>Measured growth · Pair Sum Count</span><span className="text-emerald-300">meets O(n)</span></div>
          <ComplexityChart report={report} height={120} />
        </div>
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-[11px] text-ink-300">
          <Fingerprint className="mt-0.5 size-3.5 shrink-0 text-amber-300" />
          <span>100% similar to <b className="text-ink-100">Grace Hopper</b> on “Pair Sum Count” — <span className="text-emerald-300">typed incrementally here, may be the original</span></span>
        </div>
      </div>
    </div>
  );
}

const STEPS = [
  { icon: ClipboardList, title: 'Build', body: 'Pick from 24 ready questions or write your own. Expected outputs come from your reference solution; question pools give each candidate a different draw.' },
  { icon: Send, title: 'Invite', body: 'Send private links. Candidates get a fast IDE, live results and a clear list of what is recorded — webcam, ID check and lockdown are opt-in per test.' },
  { icon: BadgeCheck, title: 'Decide', body: 'Compare candidates side by side: scores, measured complexity, code playback, integrity evidence and an optional AI review. Record your decision.' },
];

const GROUPS = [
  {
    title: 'Measure real ability', icon: Gauge, items: [
      { icon: Zap, t: 'Live judging', d: 'Every test case streams back with CPU time and memory.' },
      { icon: Activity, t: 'Big-O analyzer', d: 'Growth is measured on scaled inputs and compared with the target.' },
      { icon: Database, t: 'Code, SQL & MCQ', d: 'Eight languages; SQL judged on hidden datasets; custom checkers.' },
      { icon: History, t: 'Code playback', d: 'See how a solution was written, not just how it ended.' },
    ],
  },
  {
    title: 'Protect integrity', icon: Shield, items: [
      { icon: Fingerprint, t: 'Plagiarism detection', d: 'Winnowing across candidates and known solutions, starter code excluded.' },
      { icon: Camera, t: 'Webcam proctoring', d: 'Snapshots with on-device face detection; nobody or two people are flagged.' },
      { icon: IdCard, t: 'Identity check', d: 'Selfie and photo ID next to the snapshots.' },
      { icon: Lock, t: 'Lockdown & devices', d: 'Block outside pastes, lock to one browser, catch shared devices.' },
    ],
  },
  {
    title: 'Respect candidates', icon: UserCheck, items: [
      { icon: Eye, t: 'Radical transparency', d: 'Candidates see exactly what each test records before starting.' },
      { icon: Sparkles, t: 'Fair by design', d: 'Authorship evidence decides who is penalized for a match.' },
      { icon: Timer, t: 'Data retention', d: 'Images and device logs auto-delete after a period you choose.' },
      { icon: Code2, t: 'Free practice', d: 'Problems, progress tracking and a leaderboard for learners.' },
    ],
  },
];

const COMPARE: [string, boolean | 'partial', boolean][] = [
  ['Multi-language judge with hidden tests', true, true],
  ['Live per-test results with CPU & memory', 'partial', true],
  ['Measured Big-O growth vs. a target', false, true],
  ['Code playback of how the answer was written', 'partial', true],
  ['Plagiarism vs. other candidates and public solutions', 'partial', true],
  ['Authorship evidence before penalizing a match', false, true],
  ['On-device face detection (no video upload)', false, true],
  ['Per-candidate question pools', 'partial', true],
  ['Candidates told exactly what is recorded', 'partial', true],
];

function Mark({ v }: { v: boolean | 'partial' }) {
  if (v === true) return <Check className="mx-auto size-4 text-emerald-400" aria-label="Yes" />;
  if (v === 'partial') return <span className="text-xs text-ink-400">sometimes</span>;
  return <Minus className="mx-auto size-4 text-ink-600" aria-label="No" />;
}

export function Landing() {
  const { user, meta, login } = useAuth();
  const nav = useNavigate();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const demo = async (email: string, to: string) => {
    setBusy(email);
    setErr(null);
    try { await login(email, 'crucible123'); nav(to); } catch (e: any) { setErr(e.message); } finally { setBusy(null); }
  };
  const langs = meta?.languages.filter((l) => l.available) ?? [];
  const cta = user ? (
    <Button variant="primary" size="lg" onClick={() => nav(isStaff(user) ? '/hiring' : '/problems')}>Open {isStaff(user) ? 'hiring dashboard' : 'practice'} <ArrowRight className="size-4" /></Button>
  ) : (
    <>
      <Button variant="primary" size="lg" loading={busy === 'recruiter@crucible.dev'} onClick={() => demo('recruiter@crucible.dev', '/hiring')}>Try as a hiring manager <ArrowRight className="size-4" /></Button>
      <Button size="lg" loading={busy === 'candidate@crucible.dev'} onClick={() => demo('candidate@crucible.dev', '/problems')}>Try as a candidate</Button>
    </>
  );

  return (
    <main>
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-ink-800">
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,var(--color-ink-800)_1px,transparent_1px),linear-gradient(to_bottom,var(--color-ink-800)_1px,transparent_1px)] [mask-image:radial-gradient(ellipse_at_top,black,transparent_70%)] bg-[size:44px_44px] opacity-60" />
        <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-4 py-16 lg:grid-cols-[1.05fr_1fr] lg:py-24">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-ink-700 bg-ink-900/80 px-3 py-1 text-xs text-ink-300">
              <span className="relative flex size-2"><span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" /><span className="relative inline-flex size-2 rounded-full bg-emerald-400" /></span>
              Judge online · {langs.length || 7} languages · {meta?.workers ?? 4} sandboxed workers
            </div>
            <h1 className="mt-6 text-4xl font-semibold tracking-tight text-ink-100 sm:text-5xl lg:text-[3.4rem] lg:leading-[1.05]">
              Technical hiring on <span className="bg-gradient-to-r from-amber-300 to-ember-500 bg-clip-text text-transparent">signal</span>, not noise.
            </h1>
            <p className="mt-5 max-w-xl text-lg text-ink-300">
              Crucible shows more than whether the tests passed: <b className="font-medium text-ink-100">how the solution scales</b>, <b className="font-medium text-ink-100">how it was written</b>, and <b className="font-medium text-ink-100">whether the candidate wrote it</b>.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">{cta}</div>
            <div className="mt-3 max-w-sm"><ErrorBox error={err} /></div>
            {!user && <p className="mt-3 text-xs text-ink-500">One click, no sign-up — demo accounts use the password <code className="text-ink-300">crucible123</code>.</p>}
          </div>
          <ProductPreview />
        </div>
      </section>

      {/* Proof strip */}
      <section className="border-b border-ink-800 bg-ink-900/40">
        <div className="mx-auto grid max-w-7xl grid-cols-2 gap-6 px-4 py-8 text-center md:grid-cols-4">
          {[
            ['8', 'languages supported, each self-tested at start-up'],
            ['0', 'seconds of video uploaded — faces detected on-device'],
            ['1.00 vs 0.06', 'similarity: copies vs. independent solutions'],
            ['79', 'automated tests incl. security boundaries'],
          ].map(([n, l]) => (
            <div key={l}>
              <div className="text-2xl font-semibold tracking-tight text-ink-100">{n}</div>
              <div className="mt-1 text-xs text-ink-400">{l}</div>
            </div>
          ))}
        </div>
      </section>

      <div className="mx-auto max-w-7xl px-4">
        {/* How it works */}
        <section className="py-16">
          <h2 className="text-center text-2xl font-semibold tracking-tight text-ink-100 sm:text-3xl">From question to decision in three steps</h2>
          <ol className="mt-10 grid gap-4 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.title} className="relative rounded-2xl border border-ink-800 bg-ink-900/60 p-6">
                <span className="absolute top-5 right-5 font-mono text-xs text-ink-600">0{i + 1}</span>
                <s.icon className="size-6 text-ember-400" />
                <h3 className="mt-4 text-lg font-semibold text-ink-100">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-400">{s.body}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* Feature groups */}
        <section className="grid gap-4 pb-16 lg:grid-cols-3">
          {GROUPS.map((g) => (
            <div key={g.title} className="rounded-2xl border border-ink-800 bg-ink-900/60 p-6">
              <div className="flex items-center gap-2"><g.icon className="size-5 text-ember-400" /><h3 className="font-semibold text-ink-100">{g.title}</h3></div>
              <ul className="mt-5 space-y-4">
                {g.items.map((it) => (
                  <li key={it.t} className="flex gap-3">
                    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-ink-800"><it.icon className="size-4 text-ink-200" /></span>
                    <div><div className="text-sm font-medium text-ink-100">{it.t}</div><div className="text-sm text-ink-400">{it.d}</div></div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>

        {/* Comparison */}
        <section className="pb-16">
          <h2 className="text-center text-2xl font-semibold tracking-tight text-ink-100 sm:text-3xl">What you get that typical platforms don’t</h2>
          <div className="mx-auto mt-8 max-w-3xl overflow-hidden rounded-2xl border border-ink-800">
            <table className="w-full text-sm">
              <thead className="bg-ink-900 text-xs text-ink-400">
                <tr><th className="px-4 py-3 text-left font-medium">Capability</th><th className="w-32 px-4 py-3 font-medium">Typical platform</th><th className="w-32 bg-ember-500/10 px-4 py-3 font-semibold text-ember-300">Crucible</th></tr>
              </thead>
              <tbody>
                {COMPARE.map(([label, them, us]) => (
                  <tr key={label} className="border-t border-ink-800">
                    <td className="px-4 py-3 text-ink-200">{label}</td>
                    <td className="px-4 py-3 text-center"><Mark v={them} /></td>
                    <td className="bg-ember-500/5 px-4 py-3 text-center"><Mark v={us} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Audiences */}
        <section className="grid gap-4 pb-16 md:grid-cols-2">
          <div className="rounded-2xl border border-ink-800 bg-gradient-to-br from-ember-500/10 to-transparent p-7">
            <Users className="size-6 text-ember-400" />
            <h3 className="mt-4 text-xl font-semibold text-ink-100">For hiring teams</h3>
            <ul className="mt-4 space-y-2 text-sm text-ink-300">
              {['Rank, filter and compare candidates side by side', 'Evidence for every integrity flag — never a black box', 'Record decisions and export results', 'Optional AI review with follow-up interview questions'].map((x) => <li key={x} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-emerald-400" />{x}</li>)}
            </ul>
            <div className="mt-6">{user ? <Button onClick={() => nav('/hiring')}>Open hiring <ArrowRight className="size-4" /></Button> : <Button onClick={() => demo('recruiter@crucible.dev', '/hiring')} loading={busy === 'recruiter@crucible.dev'}>Explore the demo assessment <ArrowRight className="size-4" /></Button>}</div>
          </div>
          <div className="rounded-2xl border border-ink-800 bg-gradient-to-br from-sky-500/10 to-transparent p-7">
            <Code2 className="size-6 text-sky-300" />
            <h3 className="mt-4 text-xl font-semibold text-ink-100">For candidates & learners</h3>
            <ul className="mt-4 space-y-2 text-sm text-ink-300">
              {['A real IDE with live, per-test feedback', 'Learn how your solution scales, not just if it passes', 'Track progress, streaks and skills; climb the leaderboard', 'Know exactly what a test records before you start'].map((x) => <li key={x} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-emerald-400" />{x}</li>)}
            </ul>
            <div className="mt-6"><Button onClick={() => nav('/problems')}>Start practicing <ArrowRight className="size-4" /></Button></div>
          </div>
        </section>

        {/* Judge status */}
        {meta && (
          <section className="mb-16 rounded-2xl border border-ink-800 bg-ink-900/60 p-6">
            <div className="flex flex-wrap items-center gap-2"><Shield className="size-5 text-ember-400" /><h2 className="font-semibold text-ink-100">This judge, right now</h2><span className="text-xs text-ink-500">live from /api/meta</span></div>
            <div className="mt-4 grid gap-6 md:grid-cols-2">
              <ul className="grid grid-cols-1 gap-1.5 text-sm sm:grid-cols-2">
                {meta.languages.map((l) => (
                  <li key={l.id} className="flex items-center gap-2" title={l.available ? l.version : l.reason}>
                    <span className={cx('size-2 rounded-full', l.available ? 'bg-emerald-400' : 'bg-ink-600')} />
                    <span className={l.available ? 'text-ink-100' : 'text-ink-500 line-through'}>{l.name}</span>
                  </li>
                ))}
              </ul>
              <ul className="space-y-1.5 text-sm text-ink-300">
                {[
                  [meta.isolation.network, 'Network isolation (empty network namespace)'],
                  [meta.isolation.filesystem, 'Filesystem isolation (app and data hidden)'],
                  [meta.isolation.users, 'Unprivileged uid per worker slot'],
                  [true, 'CPU, memory, process and output limits'],
                  [meta.ai, meta.ai ? 'AI review enabled' : 'AI review off (no API key configured)'],
                ].map(([ok, label]) => (
                  <li key={label as string} className="flex items-center gap-2">{ok ? <Check className="size-4 text-emerald-400" /> : <Minus className="size-4 text-ink-500" />}{label as string}</li>
                ))}
              </ul>
            </div>
          </section>
        )}

        {/* Final CTA */}
        <section className="mb-16 overflow-hidden rounded-3xl border border-ember-500/30 bg-[radial-gradient(ellipse_at_top_right,rgba(249,115,22,.25),transparent_60%)] px-6 py-12 text-center">
          <Laptop className="mx-auto size-8 text-ember-400" />
          <h2 className="mt-4 text-2xl font-semibold tracking-tight text-ink-100 sm:text-3xl">See it with real candidates</h2>
          <p className="mx-auto mt-2 max-w-lg text-ink-300">The demo includes a screening with three candidates judged for real — one strong, one average, one who copied. Spot which is which.</p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">{cta}</div>
        </section>
      </div>

      <footer className="border-t border-ink-800">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-6 text-xs text-ink-500">
          <span className="flex items-center gap-1.5"><Shuffle className="size-3.5" /> Crucible</span>
          <Link to="/problems" className="hover:text-ink-300">Practice</Link>
          <Link to="/leaderboard" className="hover:text-ink-300">Leaderboard</Link>
          <span className="flex items-center gap-1"><BrainCircuit className="size-3.5" /> AI review is optional and off without an API key</span>
          <span className="ml-auto">Press <kbd className="rounded border border-ink-700 px-1">Ctrl K</kbd> to search</span>
        </div>
      </footer>
    </main>
  );
}
