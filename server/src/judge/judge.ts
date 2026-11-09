import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { checkBuiltin, CUSTOM_CHECKER_HARNESS, type CheckerSpec } from './checkers.js';
import { type ComplexityPoint, type ComplexityReport, type ComplexitySpec, estimateComplexity, GENERATOR_HARNESS } from './complexity.js';
import { LANGUAGE_MAP } from './languages.js';
import { type Box, readCapped, type RunResult, type Sandbox } from './sandbox.js';

export type Verdict = 'AC' | 'WA' | 'TLE' | 'MLE' | 'RE' | 'OLE' | 'CE' | 'SE' | 'OK';

export const VERDICT_LABEL: Record<Verdict, string> = {
  AC: 'Accepted',
  WA: 'Wrong Answer',
  TLE: 'Time Limit Exceeded',
  MLE: 'Memory Limit Exceeded',
  RE: 'Runtime Error',
  OLE: 'Output Limit Exceeded',
  CE: 'Compilation Error',
  SE: 'System Error',
  OK: 'Ran',
};

export interface JudgeTest {
  id?: number;
  input: string;
  expected: string;
  weight: number;
  sample: boolean;
  /** Custom input supplied by the user in "run" mode: no expected output. */
  custom?: boolean;
}

export interface TestResult {
  index: number;
  testId?: number;
  sample: boolean;
  custom?: boolean;
  verdict: Verdict;
  timeMs: number;
  memoryKb: number;
  message?: string;
  input?: string;
  expected?: string;
  output?: string;
  stderr?: string;
  /** SQL result tables. */
  table?: { columns: string[]; rows: unknown[][] };
  expectedTable?: { columns: string[]; rows: unknown[][] };
}

export interface JudgeRequest {
  language: string;
  code: string;
  tests: JudgeTest[];
  limits: { timeMs: number; memoryMb: number };
  checker: CheckerSpec;
  complexity?: (ComplexitySpec & { cacheKey: string }) | null;
  /** Return complete program output (authoring tools) instead of an 8 KB preview. */
  fullOutput?: boolean;
}

export interface SqlJudgeRequest {
  query: string;
  schema: string;
  tests: JudgeTest[];
  ordered: boolean;
}

export interface JudgeEvents {
  onCompile?: (ok: boolean, output: string) => void;
  onTest?: (r: TestResult) => void;
  onPhase?: (phase: 'compiling' | 'testing' | 'complexity') => void;
}

export interface JudgeOutcome {
  verdict: Verdict;
  score: number;
  passed: number;
  total: number;
  timeMs: number;
  memoryKb: number;
  compileOutput: string;
  results: TestResult[];
  complexity?: ComplexityReport | null;
}

const PREVIEW = 8 * 1024;
const clip = (s: string, n = PREVIEW) => (s.length > n ? `${s.slice(0, n)}\n… (${s.length - n} more bytes)` : s);

function verdictFor(r: RunResult): Verdict | null {
  switch (r.status) {
    case 'OK': return null;
    case 'TLE': return 'TLE';
    case 'MLE': return 'MLE';
    case 'OLE': return 'OLE';
    case 'RE': return 'RE';
    default: return 'SE';
  }
}

function runtimeMessage(r: RunResult, stderr: string): string {
  if (r.status === 'RE') {
    if (r.signal) {
      const names: Record<number, string> = { 6: 'SIGABRT (abort)', 8: 'SIGFPE (arithmetic error, e.g. division by zero)', 9: 'SIGKILL', 11: 'SIGSEGV (segmentation fault)' };
      return `Killed by ${names[r.signal] ?? `signal ${r.signal}`}`;
    }
    const lines = stderr.trim().split('\n').map((l) => l.trim()).filter(Boolean);
    const last = [...lines].reverse().find((l) => /(error|exception|panic|traceback|assert)/i.test(l) && !/^at /.test(l)) ?? lines.pop();
    return `Exited with code ${r.exit_code}${last ? `: ${last.slice(0, 200)}` : ''}`;
  }
  if (r.status === 'TLE') return `Exceeded the CPU time limit (${r.cpu_ms} ms used)`;
  if (r.status === 'MLE') return `Exceeded the memory limit (${Math.round(r.mem_kb / 1024)} MB used)`;
  if (r.status === 'OLE') return 'Produced too much output';
  if (r.status === 'SE') return `Sandbox error: ${r.error}`;
  return '';
}

function summarize(results: TestResult[], tests: JudgeTest[]): Pick<JudgeOutcome, 'verdict' | 'score' | 'passed' | 'total' | 'timeMs' | 'memoryKb'> {
  const graded = results.filter((r) => !r.custom);
  const totalWeight = tests.filter((t) => !t.custom).reduce((s, t) => s + t.weight, 0) || 1;
  let got = 0;
  graded.forEach((r) => {
    if (r.verdict === 'AC') got += tests[r.index].weight;
  });
  const firstBad = graded.find((r) => r.verdict !== 'AC');
  const anyCustomBad = results.find((r) => r.custom && r.verdict !== 'OK');
  let verdict: Verdict = firstBad ? firstBad.verdict : graded.length ? 'AC' : 'OK';
  if (!graded.length && anyCustomBad) verdict = anyCustomBad.verdict;
  return {
    verdict,
    score: graded.length ? got / totalWeight : 0,
    passed: graded.filter((r) => r.verdict === 'AC').length,
    total: graded.length,
    timeMs: Math.max(0, ...results.map((r) => r.timeMs)),
    memoryKb: Math.max(0, ...results.map((r) => r.memoryKb)),
  };
}

export class Judge {
  /** Generated complexity inputs, keyed by generator hash + n. */
  private genCache = new Map<string, string>();

  constructor(readonly sandbox: Sandbox) {}

  async judgeCode(req: JudgeRequest, ev: JudgeEvents = {}): Promise<JudgeOutcome> {
    const lang = this.sandbox.language(req.language);
    if (!lang) {
      const known = LANGUAGE_MAP.get(req.language);
      return {
        verdict: 'CE', score: 0, passed: 0, total: req.tests.filter((t) => !t.custom).length, timeMs: 0, memoryKb: 0,
        compileOutput: known ? `${known.name} is not available on this judge.` : `Unknown language "${req.language}".`,
        results: [],
      };
    }
    return this.sandbox.withBox(async (box) => {
      ev.onPhase?.('compiling');
      const compiled = await this.sandbox.compile(box, lang, req.code);
      ev.onCompile?.(compiled.ok, compiled.output);
      if (!compiled.ok) {
        return {
          verdict: 'CE', score: 0, passed: 0, total: req.tests.filter((t) => !t.custom).length,
          timeMs: 0, memoryKb: 0, compileOutput: compiled.output, results: [],
        };
      }
      ev.onPhase?.('testing');
      const spec = this.sandbox.execSpec(box, lang, req.limits.timeMs, req.limits.memoryMb);
      const results: TestResult[] = [];
      for (let i = 0; i < req.tests.length; i++) {
        const t = req.tests[i];
        const inFile = path.join(box.io, `in-${i}`);
        const outFile = path.join(box.io, `out-${i}`);
        const errFile = path.join(box.io, `err-${i}`);
        fs.writeFileSync(inFile, t.input);
        const r = await this.sandbox.run(box, { ...spec, cwd: box.dir, stdin: inFile, stdout: outFile, stderr: errFile });
        const out = readCapped(outFile, 16 * 1024 * 1024);
        const err = readCapped(errFile, 4096).text;
        let verdict = verdictFor(r);
        let message = verdict ? runtimeMessage(r, err) : undefined;
        if (!verdict) {
          if (t.custom) verdict = 'OK';
          else {
            const c = req.checker.type === 'custom'
              ? await this.customCheck(box, req.checker.code, t.input, t.expected, out.text)
              : checkBuiltin(req.checker, t.expected, out.text);
            verdict = c.ok ? 'AC' : 'WA';
            message = c.ok ? undefined : c.message || undefined;
          }
        }
        const res: TestResult = {
          index: i, testId: t.id, sample: t.sample, custom: t.custom, verdict,
          timeMs: r.cpu_ms, memoryKb: r.mem_kb, message,
          input: clip(t.input), expected: t.custom ? undefined : clip(t.expected),
          output: req.fullOutput ? out.text : clip(out.text), stderr: clip(err, 2048),
        };
        results.push(res);
        ev.onTest?.(res);
        for (const f of [inFile, outFile, errFile]) fs.rmSync(f, { force: true });
      }
      const summary = summarize(results, req.tests);
      let complexity: ComplexityReport | null = null;
      if (req.complexity && summary.verdict === 'AC') {
        ev.onPhase?.('complexity');
        complexity = await this.measureComplexity(box, spec, req.complexity);
      }
      return { ...summary, compileOutput: compiled.output, results, complexity };
    });
  }

  private async customCheck(box: Box, code: string, input: string, expected: string, output: string) {
    const python = LANGUAGE_MAP.get('python')!.run({ memMb: 256, cacheDir: '' })[0];
    const inFile = path.join(box.io, 'chk-in');
    const outFile = path.join(box.io, 'chk-out');
    fs.writeFileSync(inFile, JSON.stringify({ code, input, expected, output }));
    const r = await this.sandbox.run(box, {
      cmd: [python, '-c', CUSTOM_CHECKER_HARNESS], cwd: box.dir, stdin: inFile, stdout: outFile, stderr: outFile,
      cpuMs: 5000, wallMs: 10000, memKb: 512 * 1024, env: this.sandbox.baseEnv(box),
    });
    const text = readCapped(outFile, 64 * 1024).text;
    if (r.status !== 'OK') return { ok: false, message: `Checker failed (${r.status}): ${text.slice(-300)}` };
    try {
      return JSON.parse(text.trim().split('\n').pop() ?? '') as { ok: boolean; message?: string };
    } catch {
      return { ok: false, message: `Checker produced invalid output: ${text.slice(0, 200)}` };
    }
  }

  private async generateInput(box: Box, spec: ComplexitySpec & { cacheKey: string }, n: number): Promise<string | null> {
    const key = `${spec.cacheKey}:${crypto.createHash('sha1').update(spec.generator).digest('hex')}:${n}`;
    const cached = this.genCache.get(key);
    if (cached && fs.existsSync(cached)) return cached;
    const python = LANGUAGE_MAP.get('python')!.run({ memMb: 256, cacheDir: '' })[0];
    const reqFile = path.join(box.io, 'gen-req');
    const dir = path.join(this.sandbox.boxRoot, 'gen-cache');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const outFile = path.join(dir, `${crypto.createHash('sha1').update(key).digest('hex')}.in`);
    fs.writeFileSync(reqFile, JSON.stringify({ code: spec.generator, n }));
    const r = await this.sandbox.run(box, {
      cmd: [python, '-c', GENERATOR_HARNESS], cwd: box.dir, stdin: reqFile, stdout: outFile, stderr: path.join(box.io, 'gen-err'),
      cpuMs: 20000, wallMs: 30000, memKb: 1024 * 1024, fsizeKb: 128 * 1024, env: this.sandbox.baseEnv(box),
    });
    if (r.status !== 'OK') return null;
    this.genCache.set(key, outFile);
    return outFile;
  }

  private async measureComplexity(
    box: Box,
    spec: ReturnType<Sandbox['execSpec']>,
    cx: ComplexitySpec & { cacheKey: string },
  ): Promise<ComplexityReport> {
    const points: ComplexityPoint[] = [];
    const inputBytes: { n: number; bytes: number }[] = [];
    const sizes = [...cx.sizes].sort((a, b) => a - b);
    const budget = { ...spec, cpuMs: Math.max(spec.cpuMs, 4000), wallMs: Math.max(spec.wallMs, 9000) };
    for (const n of sizes) {
      const input = await this.generateInput(box, cx, n);
      if (!input) {
        return { ...estimateComplexity(points, cx.expected), note: 'The input generator failed for this problem.' };
      }
      inputBytes.push({ n, bytes: fs.statSync(input).size });
      let best: RunResult | null = null;
      // Take the faster of two runs to reduce scheduling noise on small inputs.
      for (let rep = 0; rep < 2; rep++) {
        const r = await this.sandbox.run(box, {
          ...budget, cwd: box.dir, stdin: input, stdout: '/dev/null', stderr: '/dev/null',
        });
        if (!best || r.status !== 'OK' || r.cpu_ms < best.cpu_ms) best = r;
        if (r.status !== 'OK' || r.cpu_ms > 1500) break;
      }
      points.push({ n, cpuMs: best!.cpu_ms, status: best!.status });
      if (best!.status !== 'OK') break;
    }
    // Does the input itself grow (at least roughly) linearly with n?
    const first = inputBytes[0];
    const last = inputBytes[inputBytes.length - 1];
    const linearInput = !!first && !!last && last.n > first.n && last.bytes / first.bytes >= 0.5 * (last.n / first.n);
    return estimateComplexity(points, cx.expected, { linearInput });
  }

  async judgeSql(req: SqlJudgeRequest, ev: JudgeEvents = {}): Promise<JudgeOutcome> {
    return this.sandbox.withBox(async (box) => {
      ev.onPhase?.('testing');
      const results: TestResult[] = [];
      for (let i = 0; i < req.tests.length; i++) {
        const t = req.tests[i];
        const res = await this.runSql(box, req.schema, t.input, req.query);
        let verdict: Verdict;
        let message: string | undefined;
        let expectedTable: TestResult['expectedTable'];
        if (res.error) {
          verdict = res.kind === 'limit' ? 'TLE' : 'RE';
          message = res.error;
        } else {
          expectedTable = safeTable(t.expected);
          const cmp = compareTables(expectedTable, res.table!, req.ordered);
          verdict = cmp.ok ? 'AC' : 'WA';
          message = cmp.message;
        }
        const r: TestResult = {
          index: i, testId: t.id, sample: t.sample, verdict, timeMs: res.timeMs, memoryKb: res.memKb, message,
          input: clip(t.input, 4096), table: res.table ? { columns: res.table.columns, rows: res.table.rows.slice(0, 50) } : undefined,
          expectedTable: expectedTable ? { columns: expectedTable.columns, rows: expectedTable.rows.slice(0, 50) } : undefined,
        };
        results.push(r);
        ev.onTest?.(r);
      }
      return { ...summarize(results, req.tests), compileOutput: '', results };
    });
  }

  /** Execute a query against schema + data inside the sandbox. */
  async runSql(box: Box, schema: string, data: string, query: string) {
    const python = LANGUAGE_MAP.get('python')!.run({ memMb: 256, cacheDir: '' })[0];
    const reqFile = path.join(box.io, 'sql-req');
    const outFile = path.join(box.io, 'sql-out');
    fs.writeFileSync(reqFile, JSON.stringify({ schema, data, query }));
    const r = await this.sandbox.run(box, {
      cmd: [python, '-c', SQL_HARNESS], cwd: box.dir, stdin: reqFile, stdout: outFile, stderr: outFile,
      cpuMs: 4000, wallMs: 8000, memKb: 512 * 1024, env: this.sandbox.baseEnv(box),
    });
    const text = readCapped(outFile, 4 * 1024 * 1024).text;
    if (r.status !== 'OK') {
      return { error: r.status === 'TLE' ? 'Query exceeded the time limit' : `Query failed (${r.status})`, kind: 'limit', timeMs: r.cpu_ms, memKb: r.mem_kb };
    }
    try {
      const j = JSON.parse(text.trim().split('\n').pop() ?? '{}');
      if (j.error || j.setup_error) return { error: j.error ?? `Dataset setup failed: ${j.setup_error}`, kind: 'sql', timeMs: r.cpu_ms, memKb: r.mem_kb };
      return { table: { columns: j.columns as string[], rows: j.rows as unknown[][] }, timeMs: r.cpu_ms, memKb: r.mem_kb };
    } catch {
      return { error: `Unexpected output: ${text.slice(0, 200)}`, kind: 'sql', timeMs: r.cpu_ms, memKb: r.mem_kb };
    }
  }

  /** Compute expected tables for SQL test cases from the reference solution. */
  async sqlExpected(schema: string, datasets: string[], solution: string): Promise<string[]> {
    return this.sandbox.withBox(async (box) => {
      const out: string[] = [];
      for (const d of datasets) {
        const r = await this.runSql(box, schema, d, solution);
        if (r.error) throw new Error(`Reference solution failed: ${r.error}`);
        out.push(JSON.stringify(r.table));
      }
      return out;
    });
  }

  /** Run a reference program to produce expected outputs (used by authoring tools). */
  async expectedOutputs(language: string, code: string, inputs: string[], limits = { timeMs: 5000, memoryMb: 512 }) {
    const o = await this.judgeCode({
      language, code, limits, checker: { type: 'exact' }, fullOutput: true,
      tests: inputs.map((input) => ({ input, expected: '', weight: 1, sample: false, custom: true })),
    });
    if (o.verdict === 'CE') throw new Error(`Reference solution failed to compile: ${o.compileOutput}`);
    const bad = o.results.find((r) => r.verdict !== 'OK');
    const cut = o.results.find((r) => (r.output ?? '').length >= 16 * 1024 * 1024);
    if (cut) throw new Error(`Reference output for input ${cut.index + 1} exceeds 16 MB.`);
    if (bad) throw new Error(`Reference solution failed on input ${bad.index + 1}: ${bad.verdict} ${bad.message ?? ''}`);
    return o.results.map((r) => r.output ?? '');
  }
}

const SQL_HARNESS = `
import sys, json, sqlite3
d = json.load(sys.stdin)
con = sqlite3.connect(":memory:")
try:
    con.executescript(d["schema"])
    con.executescript(d["data"])
    con.commit()
except Exception as e:
    print(json.dumps({"setup_error": str(e)})); sys.exit(0)
def auth(action, a1, a2, db, src):
    if action in (sqlite3.SQLITE_ATTACH, sqlite3.SQLITE_DETACH):
        return sqlite3.SQLITE_DENY
    return sqlite3.SQLITE_OK
con.set_authorizer(auth)
q = d["query"].strip()
while q.endswith(";"):
    q = q[:-1].rstrip()
try:
    cur = con.execute(q)
    cols = [c[0] for c in cur.description] if cur.description else []
    rows = cur.fetchmany(5001)
    print(json.dumps({"columns": cols, "rows": [list(r) for r in rows]}, default=str))
except Exception as e:
    print(json.dumps({"error": str(e)}))
`;

function safeTable(s: string): { columns: string[]; rows: unknown[][] } {
  try {
    const t = JSON.parse(s);
    return { columns: t.columns ?? [], rows: t.rows ?? [] };
  } catch {
    return { columns: [], rows: [] };
  }
}

const normCell = (v: unknown) => {
  if (typeof v === 'number') return Number.isInteger(v) ? v : Math.round(v * 1e6) / 1e6;
  return v;
};

export function compareTables(
  exp: { columns: string[]; rows: unknown[][] },
  got: { columns: string[]; rows: unknown[][] },
  ordered: boolean,
): { ok: boolean; message?: string } {
  if (exp.columns.length !== got.columns.length) {
    return { ok: false, message: `Expected ${exp.columns.length} columns (${exp.columns.join(', ')}), got ${got.columns.length}` };
  }
  if (exp.rows.length !== got.rows.length) {
    return { ok: false, message: `Expected ${exp.rows.length} rows, got ${got.rows.length}` };
  }
  const key = (r: unknown[]) => JSON.stringify(r.map(normCell));
  const a = exp.rows.map(key);
  const b = got.rows.map(key);
  if (!ordered) {
    a.sort();
    b.sort();
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return { ok: false, message: ordered ? `Row ${i + 1} differs (row order matters for this question)` : 'Result rows differ' };
    }
  }
  return { ok: true };
}
