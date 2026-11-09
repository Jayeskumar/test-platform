import { cx } from '../lib/format';
import type { ComplexityReport } from '../lib/types';

const GROWTH: Record<string, (n: number) => number> = {
  'O(1)': () => 1,
  'O(log n)': (n) => Math.log2(Math.max(2, n)),
  'O(√n)': (n) => Math.sqrt(n),
  'O(n)': (n) => n,
  'O(n log n)': (n) => n * Math.log2(Math.max(2, n)),
  'O(n^2)': (n) => n * n,
  'O(n^3)': (n) => n * n * n,
};

const fmtN = (n: number) => (n >= 1e6 ? `${n / 1e6}M` : n >= 1e3 ? `${n / 1e3}k` : String(n));

export function ComplexityChart({ report, height = 200 }: { report: ComplexityReport; height?: number }) {
  const W = 460;
  const H = height;
  const pad = { l: 44, r: 12, t: 12, b: 28 };
  const pts = report.points;
  if (!pts.length) return null;
  const maxN = Math.max(...pts.map((p) => p.n)) * 1.04;
  const f = GROWTH[report.expected] ?? GROWTH['O(n)'];
  const okPts = pts.filter((p) => p.status === 'OK');
  const t0 = okPts.length ? Math.min(...okPts.map((p) => p.cpuMs)) : 0;
  const first = okPts[0] ?? pts[0];
  // Target curve anchored at the smallest input: how time *should* grow from there.
  const base = t0 * 0.85;
  const a = first.n ? Math.max(0, first.cpuMs - base) / f(first.n) : 0;
  const target = (n: number) => base + a * f(n);
  const maxT = Math.max(...pts.map((p) => p.cpuMs), target(pts[pts.length - 1].n) * 0.0 + 1, ...okPts.map((p) => p.cpuMs)) * 1.15;
  const yMax = Math.max(maxT, 10);
  const x = (n: number) => pad.l + (n / maxN) * (W - pad.l - pad.r);
  const y = (t: number) => H - pad.b - (Math.min(t, yMax) / yMax) * (H - pad.t - pad.b);
  const curve = Array.from({ length: 60 }, (_, i) => {
    const n = first.n + ((maxN - first.n) * i) / 59;
    return `${i ? 'L' : 'M'}${x(n).toFixed(1)},${y(target(n)).toFixed(1)}`;
  }).join(' ');
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.n).toFixed(1)},${y(p.cpuMs).toFixed(1)}`).join(' ');
  const ticksY = [0, 0.25, 0.5, 0.75, 1].map((k) => k * yMax);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-[560px]" role="img" aria-label={`Measured CPU time against input size; estimated ${report.estimate}, target ${report.expected}`}>
      {ticksY.map((t, i) => (
        <g key={i}>
          <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="var(--color-ink-800)" />
          <text x={pad.l - 6} y={y(t) + 3} textAnchor="end" fontSize="9" fill="var(--color-ink-400)">{Math.round(t)}ms</text>
        </g>
      ))}
      {pts.filter((p, i) => i === pts.length - 1 || x(pts[pts.length - 1].n) - x(p.n) >= 26 && (i === 0 || pts.slice(0, i).every((q) => x(p.n) - x(q.n) >= 26 || q.n === p.n))).map((p) => (
        <text key={p.n} x={x(p.n)} y={H - 10} textAnchor="middle" fontSize="9" fill="var(--color-ink-400)">{fmtN(p.n)}</text>
      ))}
      <path d={curve} fill="none" stroke="var(--color-ink-400)" strokeDasharray="4 4" strokeWidth="1.5" />
      <path d={line} fill="none" stroke="var(--color-ember-500)" strokeWidth="2.5" strokeLinejoin="round" />
      {pts.map((p) => (
        <circle key={p.n} cx={x(p.n)} cy={y(p.cpuMs)} r={p.status === 'OK' ? 3.5 : 5} fill={p.status === 'OK' ? 'var(--color-ember-400)' : '#f43f5e'} stroke="var(--color-ink-950)" strokeWidth="1.5">
          <title>{`n = ${p.n.toLocaleString()}: ${p.cpuMs} ms${p.status !== 'OK' ? ` (${p.status})` : ''}`}</title>
        </circle>
      ))}
    </svg>
  );
}

export function ComplexityCard({ report }: { report: ComplexityReport }) {
  return (
    <div className="rounded-lg border border-ink-700 bg-ink-900 p-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-ink-400">Measured growth</div>
          <div className={cx('font-mono text-lg font-semibold', report.meetsTarget ? 'text-emerald-300' : 'text-rose-300')}>{report.estimate}</div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wide text-ink-400">Target</div>
          <div className="font-mono text-lg text-ink-200">{report.expected}</div>
        </div>
        {report.slope != null && (
          <div>
            <div className="text-[11px] uppercase tracking-wide text-ink-400">log-log slope</div>
            <div className="font-mono text-lg text-ink-200">{report.slope}</div>
          </div>
        )}
        <div className={cx('ml-auto rounded-md px-2 py-1 text-xs font-medium', report.meetsTarget ? 'bg-emerald-500/10 text-emerald-300' : 'bg-rose-500/10 text-rose-300')}>
          {report.meetsTarget ? 'Meets target' : 'Slower than target'}
        </div>
      </div>
      <div className="mt-2"><ComplexityChart report={report} /></div>
      <div className="flex items-center gap-4 text-[11px] text-ink-400">
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-ember-500" /> your solution</span>
        <span className="flex items-center gap-1.5"><span className="h-0 w-4 border-t border-dashed border-ink-400" /> {report.expected} from the first point</span>
      </div>
      {report.note && <div className="mt-2 text-xs text-amber-200">{report.note}</div>}
      <p className="mt-2 text-[11px] leading-relaxed text-ink-500">
        Estimated by running your program on generated inputs of increasing size and fitting CPU time against growth models. It is an empirical estimate, not a proof.
      </p>
    </div>
  );
}

export function Radar({ data, size = 240 }: { data: { label: string; value: number }[]; size?: number }) {
  if (data.length < 3) return null;
  const c = size / 2;
  const R = size / 2 - 36;
  const pt = (i: number, r: number) => {
    const a = (Math.PI * 2 * i) / data.length - Math.PI / 2;
    return [c + Math.cos(a) * r, c + Math.sin(a) * r];
  };
  const poly = data.map((d, i) => pt(i, R * Math.max(0.03, d.value)).join(',')).join(' ');
  return (
    <svg viewBox={`-40 0 ${size + 80} ${size}`} className="w-full max-w-[340px]" role="img" aria-label="Skill coverage by topic">
      {[0.25, 0.5, 0.75, 1].map((k) => (
        <polygon key={k} points={data.map((_, i) => pt(i, R * k).join(',')).join(' ')} fill="none" stroke="var(--color-ink-700)" />
      ))}
      {data.map((_, i) => {
        const [px, py] = pt(i, R);
        return <line key={i} x1={c} y1={c} x2={px} y2={py} stroke="var(--color-ink-800)" />;
      })}
      <polygon points={poly} fill="rgba(249,115,22,.22)" stroke="var(--color-ember-500)" strokeWidth="2" />
      {data.map((d, i) => {
        const [px, py] = pt(i, R + 18);
        return (
          <text key={d.label} x={px} y={py} textAnchor="middle" dominantBaseline="middle" fontSize="9.5" fill="var(--color-ink-300)">
            {d.label.length > 14 ? `${d.label.slice(0, 13)}…` : d.label}
            <title>{`${d.label}: ${Math.round(d.value * 100)}%`}</title>
          </text>
        );
      })}
    </svg>
  );
}

export function Heatmap({ days }: { days: { day: string; n: number }[] }) {
  const map = new Map(days.map((d) => [d.day, d.n]));
  const weeks = 26;
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (weeks * 7 - 1) - end.getUTCDay());
  const cells: { x: number; y: number; n: number; key: string }[] = [];
  for (let i = 0; i < weeks * 7 + end.getUTCDay() + 1; i++) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    const key = d.toISOString().slice(0, 10);
    cells.push({ x: Math.floor(i / 7), y: i % 7, n: map.get(key) ?? 0, key });
  }
  const color = (n: number) => (n === 0 ? 'var(--color-ink-800)' : n < 2 ? '#7c2d12' : n < 4 ? '#c2410c' : n < 7 ? '#ea580c' : '#fb923c');
  const W = (weeks + 1) * 13;
  return (
    <svg viewBox={`0 0 ${W} ${7 * 13}`} className="w-full" role="img" aria-label="Submission activity over the last six months">
      {cells.map((c) => (
        <rect key={c.key} x={c.x * 13} y={c.y * 13} width="10" height="10" rx="2" fill={color(c.n)}>
          <title>{`${c.key}: ${c.n} submission${c.n === 1 ? '' : 's'}`}</title>
        </rect>
      ))}
    </svg>
  );
}

export function Histogram({ values, max = 100, bins = 10, highlight }: { values: number[]; max?: number; bins?: number; highlight?: number }) {
  const counts = Array(bins).fill(0);
  values.forEach((v) => counts[Math.min(bins - 1, Math.floor((v / max) * bins))]++);
  const top = Math.max(1, ...counts);
  const hb = highlight != null ? Math.min(bins - 1, Math.floor((highlight / max) * bins)) : -1;
  return (
    <div>
      <div className="flex h-24 items-end gap-1">
        {counts.map((c, i) => (
          <div key={i} className="flex h-full flex-1 flex-col items-center justify-end" title={`${(i * max) / bins}–${((i + 1) * max) / bins}%: ${c}`}>
            <div className={cx('w-full rounded-t', i === hb ? 'bg-ember-500' : 'bg-ink-600')} style={{ height: `${(c / top) * 100}%`, minHeight: c ? 4 : 1 }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-ink-500"><span>0%</span><span>50%</span><span>100%</span></div>
    </div>
  );
}

export function ScoreRing({ value, size = 88, label }: { value: number; size?: number; label?: string }) {
  const r = size / 2 - 7;
  const C = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, value));
  const color = v >= 75 ? '#34d399' : v >= 50 ? '#fbbf24' : '#fb7185';
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${label ?? 'Score'} ${Math.round(v)} percent`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-ink-800)" strokeWidth="7" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="7" strokeLinecap="round" strokeDasharray={`${(v / 100) * C} ${C}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central" fontSize={size / 4.4} fontWeight="600" fill="var(--color-ink-100)">{Math.round(v)}%</text>
    </svg>
  );
}
