import { type FormEvent, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Logo } from '../components/Layout';
import { Button, ErrorBox, Input, Label } from '../components/ui';
import { isStaff, useAuth } from '../lib/auth';
import { cx } from '../lib/format';

function Shell({ title, children, footer }: { title: string; children: React.ReactNode; footer: React.ReactNode }) {
  return (
    <div className="flex min-h-full items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <Logo className="mb-8 justify-center" />
        <div className="rounded-2xl border border-ink-800 bg-ink-900/80 p-6">
          <h1 className="mb-5 text-lg font-semibold text-ink-100">{title}</h1>
          {children}
        </div>
        <div className="mt-4 text-center text-sm text-ink-400">{footer}</div>
      </div>
    </div>
  );
}

export function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const loc = useLocation() as { state?: { from?: string } };
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const u = await login(email, password);
      // Only follow same-site paths (never "//host" or "/\\host" style redirects).
      const from = loc.state?.from;
      const safe = typeof from === 'string' && /^\/(?![\/\\])/.test(from) ? from : null;
      nav(safe ?? (isStaff(u) ? '/hiring' : '/problems'));
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Shell title="Sign in" footer={<>New here? <Link to="/register" className="text-ember-300 underline underline-offset-2 hover:text-ember-200">Create an account</Link></>}>
      <form onSubmit={submit} className="space-y-4">
        <div><Label>Email</Label><Input aria-label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div><Label>Password</Label><Input aria-label="Password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></div>
        <ErrorBox error={err} />
        <Button variant="primary" className="w-full" loading={busy} type="submit">Sign in</Button>
        <p className="text-xs text-ink-500">Demo: recruiter@crucible.dev or candidate@crucible.dev, password crucible123</p>
      </form>
    </Shell>
  );
}

export function Register() {
  const { register } = useAuth();
  const nav = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'candidate' as 'candidate' | 'recruiter' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const u = await register(form);
      nav(isStaff(u) ? '/hiring' : '/problems');
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Shell title="Create your account" footer={<>Already have one? <Link to="/login" className="text-ember-300 underline underline-offset-2 hover:text-ember-200">Sign in</Link></>}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          {(['candidate', 'recruiter'] as const).map((r) => (
            <button type="button" key={r} onClick={() => setForm({ ...form, role: r })} className={cx('rounded-lg border px-3 py-2 text-left text-sm', form.role === r ? 'border-ember-500/60 bg-ember-500/10 text-ink-100' : 'border-ink-700 text-ink-400 hover:border-ink-600')}>
              <div className="font-medium">{r === 'candidate' ? 'I’m practicing' : 'I’m hiring'}</div>
              <div className="text-xs">{r === 'candidate' ? 'Solve problems' : 'Run assessments'}</div>
            </button>
          ))}
        </div>
        <div><Label>Name</Label><Input aria-label="Name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoComplete="name" /></div>
        <div><Label>Email</Label><Input aria-label="Email" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="email" /></div>
        <div><Label hint="8+ characters">Password</Label><Input aria-label="Password" type="password" required minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" /></div>
        <ErrorBox error={err} />
        <Button variant="primary" className="w-full" loading={busy} type="submit">Create account</Button>
      </form>
    </Shell>
  );
}
