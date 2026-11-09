import { Activity, BrainCircuit, Database, Eye, Fingerprint, Gauge, History, Lock, Shield, Zap } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Page } from '../components/Layout';
import { Button, ErrorBox } from '../components/ui';
import { isStaff, useAuth } from '../lib/auth';

const FEATURES = [
  { icon: Zap, title: 'Live judging', body: 'Every test case streams back the moment it finishes, with exact CPU time and peak memory measured by the sandbox.' },
  { icon: Gauge, title: 'Big-O analyzer', body: 'Accepted solutions are re-run on growing inputs and fitted against growth models, so an O(n²) answer that squeaks past the tests still gets caught.' },
  { icon: Lock, title: 'Hardened sandbox', body: 'No network, a private filesystem view, dropped privileges and rlimits on CPU, memory, processes and output.' },
  { icon: Fingerprint, title: 'Plagiarism detection', body: 'MOSS-style winnowing over normalized tokens compares each candidate with the others and with known solutions. Renaming variables won’t hide a copy.' },
  { icon: History, title: 'Code playback', body: 'Scrub through how a solution was written, keystroke batch by keystroke batch. Pastes and sudden insertions are marked on the timeline.' },
  { icon: Eye, title: 'Integrity signals', body: 'Tab switches, fullscreen exits and large pastes feed an integrity score. When two candidates match, authorship evidence decides who is penalized.' },
  { icon: Database, title: 'SQL, MCQ & code', body: 'SQL queries are judged against several hidden datasets. Checkers support exact, token, float-tolerance, any-order or custom Python output.' },
  { icon: BrainCircuit, title: 'AI review (optional)', body: 'Connect an Anthropic API key and Claude writes a structured review of each submission, with suggested follow-up interview questions.' },
];

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
  return (
    <Page>
      <section className="relative overflow-hidden rounded-3xl border border-ink-800 bg-[radial-gradient(ellipse_at_top,rgba(249,115,22,0.16),transparent_60%)] px-6 py-16 text-center sm:px-12">
        <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-ink-700 bg-ink-900/80 px-3 py-1 text-xs text-ink-300">
          <Activity className="size-3.5 text-ember-400" /> {langs.length || 7} languages · sandboxed judge · {meta?.workers ?? 4} parallel workers
        </div>
        <h1 className="mx-auto mt-6 max-w-3xl text-4xl font-semibold tracking-tight text-ink-100 sm:text-5xl">
          Technical hiring on <span className="bg-gradient-to-r from-amber-300 to-ember-500 bg-clip-text text-transparent">signal</span>, not noise.
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-base text-ink-300">
          Crucible tells you more than whether a candidate passed the tests: how their solution scales, how they wrote it, and whether they wrote it.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          {user ? (
            <Button variant="primary" size="lg" onClick={() => nav(isStaff(user) ? '/hiring' : '/problems')}>Open {isStaff(user) ? 'hiring dashboard' : 'practice'}</Button>
          ) : (
            <>
              <Button variant="primary" size="lg" loading={busy === 'recruiter@crucible.dev'} onClick={() => demo('recruiter@crucible.dev', '/hiring')}>Try as a hiring manager</Button>
              <Button size="lg" loading={busy === 'candidate@crucible.dev'} onClick={() => demo('candidate@crucible.dev', '/problems')}>Try as a candidate</Button>
            </>
          )}
        </div>
        <div className="mx-auto mt-4 max-w-sm"><ErrorBox error={err} /></div>
        {!user && <p className="mt-3 text-xs text-ink-500">Demo accounts use the password <code className="text-ink-300">crucible123</code>.</p>}
      </section>

      <section className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {FEATURES.map((f) => (
          <div key={f.title} className="rounded-2xl border border-ink-800 bg-ink-900/60 p-5">
            <f.icon className="size-5 text-ember-400" />
            <h3 className="mt-3 font-semibold text-ink-100">{f.title}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-400">{f.body}</p>
          </div>
        ))}
      </section>

      {meta && (
        <section className="mt-12 rounded-2xl border border-ink-800 bg-ink-900/60 p-6">
          <div className="flex items-center gap-2"><Shield className="size-5 text-ember-400" /><h2 className="font-semibold text-ink-100">This judge, right now</h2></div>
          <div className="mt-4 grid gap-6 md:grid-cols-2">
            <ul className="space-y-1.5 text-sm">
              {meta.languages.map((l) => (
                <li key={l.id} className="flex items-center gap-2">
                  <span className={l.available ? 'text-emerald-400' : 'text-ink-500'}>{l.available ? '●' : '○'}</span>
                  <span className={l.available ? 'text-ink-100' : 'text-ink-500'}>{l.name}</span>
                  <span className="truncate text-xs text-ink-500">{l.available ? l.version : 'unavailable on this host'}</span>
                </li>
              ))}
            </ul>
            <ul className="space-y-1.5 text-sm text-ink-300">
              <li>{meta.isolation.network ? '✓' : '✗'} Network isolation (empty network namespace)</li>
              <li>{meta.isolation.filesystem ? '✓' : '✗'} Filesystem isolation (app and data directories hidden)</li>
              <li>{meta.isolation.users ? '✓' : '✗'} Unprivileged uid per worker slot</li>
              <li>✓ CPU, memory, process and output limits</li>
              <li>{meta.ai ? '✓ AI review enabled' : '○ AI review off (no API key configured)'}</li>
            </ul>
          </div>
        </section>
      )}
      <footer className="mt-12 pb-4 text-center text-xs text-ink-500">
        Crucible · <Link to="/problems" className="hover:text-ink-300">Practice problems</Link> · <Link to="/leaderboard" className="hover:text-ink-300">Leaderboard</Link>
      </footer>
    </Page>
  );
}
