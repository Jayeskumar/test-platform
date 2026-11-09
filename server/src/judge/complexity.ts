/**
 * Empirical complexity estimation: fit measured CPU times at increasing input
 * sizes against classic growth models and pick the best explanation.
 */

export interface ComplexitySpec {
  /** Python source defining generate(n) -> str (the program's stdin). */
  generator: string;
  sizes: number[];
  /** Target complexity, e.g. "O(n log n)". */
  expected: string;
}

export interface ComplexityPoint {
  n: number;
  cpuMs: number;
  status: string;
}

export interface ComplexityReport {
  estimate: string;
  expected: string;
  meetsTarget: boolean;
  confidence: number;
  slope: number | null;
  points: ComplexityPoint[];
  fits: { model: string; error: number }[];
  note?: string;
}

interface Model {
  id: string;
  rank: number;
  /** Effective polynomial exponent, compared with the measured log-log slope. */
  exp: number;
  f: (n: number) => number;
}

const log2 = (n: number) => Math.log2(Math.max(2, n));

export const MODELS: Model[] = [
  { id: 'O(1)', rank: 0, exp: 0, f: () => 1 },
  { id: 'O(log n)', rank: 1, exp: 0.1, f: (n) => log2(n) },
  { id: 'O(√n)', rank: 2, exp: 0.5, f: (n) => Math.sqrt(n) },
  { id: 'O(n)', rank: 3, exp: 1, f: (n) => n },
  { id: 'O(n log n)', rank: 4, exp: 1.1, f: (n) => n * log2(n) },
  { id: 'O(n^2)', rank: 5, exp: 2, f: (n) => n * n },
  { id: 'O(n^3)', rank: 6, exp: 3, f: (n) => n * n * n },
  { id: 'O(2^n)', rank: 7, exp: 5, f: (n) => 2 ** n },
];

export const rankOf = (id: string) => MODELS.find((m) => m.id === id.replace(/\s+/g, ' ').replace('n²', 'n^2'))?.rank ?? -1;

/** Least squares fit of t = a*f(n) + b with a >= 0. Returns normalized RMSE. */
function fit(model: Model, pts: { n: number; t: number }[]): number {
  const xs = pts.map((p) => model.f(p.n));
  const ys = pts.map((p) => p.t);
  const k = pts.length;
  const mx = xs.reduce((s, x) => s + x, 0) / k;
  const my = ys.reduce((s, y) => s + y, 0) / k;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < k; i++) {
    sxx += (xs[i] - mx) ** 2;
    sxy += (xs[i] - mx) * (ys[i] - my);
  }
  let a = sxx > 0 ? sxy / sxx : 0;
  if (a < 0) a = 0;
  const b = my - a * mx;
  let se = 0;
  for (let i = 0; i < k; i++) se += (a * xs[i] + b - ys[i]) ** 2;
  const scale = Math.max(1, Math.max(...ys) - Math.min(...ys));
  return Math.sqrt(se / k) / scale;
}

export function estimateComplexity(points: ComplexityPoint[], expected: string): ComplexityReport {
  const ok = points.filter((p) => p.status === 'OK');
  const timedOut = points.find((p) => p.status !== 'OK');
  const base: Omit<ComplexityReport, 'estimate' | 'meetsTarget' | 'confidence' | 'slope' | 'fits'> = { expected, points };
  if (ok.length < 3) {
    return {
      ...base,
      estimate: 'unknown',
      meetsTarget: false,
      confidence: 0,
      slope: null,
      fits: [],
      note: timedOut
        ? `Exceeded the time budget at n = ${timedOut.n.toLocaleString()} — growth is likely worse than ${expected}.`
        : 'Not enough measurements to estimate growth.',
    };
  }
  const pts = ok.map((p) => ({ n: p.n, t: p.cpuMs }));
  const maxN = Math.max(...pts.map((p) => p.n));
  const candidates = MODELS.filter((m) => m.id !== 'O(2^n)' || maxN <= 40);
  // Log-log slope over the larger half of the range (startup costs dominate small n).
  let slope: number | null = null;
  const tail = pts.slice(Math.floor(pts.length / 2));
  if (tail.length >= 2) {
    const t0 = Math.min(...pts.map((p) => p.t)) * 0.9;
    const a = tail[0];
    const b = tail[tail.length - 1];
    if (b.t - t0 > 1 && a.t - t0 > 0.5 && b.n > a.n) {
      slope = Math.round((Math.log(b.t - t0) - Math.log(a.t - t0)) / Math.log(b.n / a.n) * 100) / 100;
    }
  }
  const fits = candidates.map((m) => ({ model: m.id, rank: m.rank, exp: m.exp, error: fit(m, pts) }));
  const spread = Math.max(...pts.map((p) => p.t)) - Math.min(...pts.map((p) => p.t));

  let estimate: string;
  let confidence: number;
  if (spread < 8) {
    // Everything ran in a few ms: the program is effectively constant/startup-dominated at these sizes.
    estimate = 'O(1)';
    confidence = 0.5;
  } else {
    // The measured growth rate rules out models whose exponent is far from it
    // (least squares alone cannot tell √n from n on a short, noisy range).
    const plausible = fits.filter((f) => f.model !== 'O(1)' && (slope == null || Math.abs(f.exp - slope) <= 0.4 || f.exp >= 2 && slope >= 1.6));
    const pool = plausible.length ? plausible : fits.filter((f) => f.model !== 'O(1)');
    const best = Math.min(...pool.map((f) => f.error));
    // Prefer the simplest plausible model that explains the data almost as well as the best one.
    const chosen = pool.sort((a, b) => a.rank - b.rank).find((f) => f.error <= best * 1.25 + 0.01)!;
    estimate = chosen.model;
    const sorted = [...fits].sort((a, b) => a.error - b.error);
    const runnerUp = sorted.find((f) => f.model !== chosen.model)?.error ?? 1;
    confidence = Math.max(0, Math.min(1, 1 - chosen.error * 4)) * Math.min(1, (runnerUp + 0.01) / (chosen.error + 0.01) / 2);
    confidence = Math.round(Math.max(0.05, Math.min(0.99, 0.4 + confidence)) * 100) / 100;
  }


  let meets = rankOf(estimate) <= rankOf(expected);
  let note: string | undefined;
  if (timedOut) {
    meets = false;
    note = `Exceeded the time budget at n = ${timedOut.n.toLocaleString()}.`;
  }
  return {
    ...base,
    estimate,
    meetsTarget: meets,
    confidence,
    slope,
    fits: fits.map(({ model, error }) => ({ model, error: Math.round(error * 1000) / 1000 })),
    note,
  };
}

export const GENERATOR_HARNESS = `
import sys, json, random
d = json.load(sys.stdin)
random.seed(1234 + int(d["n"]))
ns = {"random": random}
exec(compile(d["code"], "generator.py", "exec"), ns)
out = ns["generate"](int(d["n"]))
sys.stdout.write(out if out.endswith("\\n") else out + "\\n")
`;
