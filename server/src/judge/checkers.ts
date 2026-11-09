export type CheckerSpec =
  | { type: 'exact' }
  | { type: 'tokens' }
  | { type: 'float'; tolerance?: number }
  | { type: 'unordered' }
  | { type: 'custom'; code: string };

export interface CheckResult {
  ok: boolean;
  message?: string;
}

const normLines = (s: string) =>
  s.replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/[ \t]+$/, '')).join('\n').replace(/\n+$/, '');

const tokens = (s: string) => s.split(/\s+/).filter(Boolean);

function firstDiff(exp: string[], got: string[], what: string): string {
  for (let i = 0; i < Math.max(exp.length, got.length); i++) {
    if (exp[i] !== got[i]) {
      if (got[i] === undefined) return `Output ended early: expected ${what} ${i + 1} to be "${clip(exp[i])}"`;
      if (exp[i] === undefined) return `Unexpected extra ${what} ${i + 1}: "${clip(got[i])}"`;
      return `Mismatch at ${what} ${i + 1}: expected "${clip(exp[i])}", got "${clip(got[i])}"`;
    }
  }
  return 'Outputs differ';
}

const clip = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** Built-in checkers. Custom checkers run in the sandbox (see judge.ts). */
export function checkBuiltin(spec: CheckerSpec, expected: string, output: string): CheckResult {
  switch (spec.type) {
    case 'exact': {
      const e = normLines(expected);
      const o = normLines(output);
      return e === o ? { ok: true } : { ok: false, message: firstDiff(e.split('\n'), o.split('\n'), 'line') };
    }
    case 'tokens': {
      const e = tokens(expected);
      const o = tokens(output);
      return e.length === o.length && e.every((t, i) => t === o[i])
        ? { ok: true }
        : { ok: false, message: firstDiff(e, o, 'token') };
    }
    case 'float': {
      const tol = spec.tolerance ?? 1e-6;
      const e = tokens(expected);
      const o = tokens(output);
      if (e.length !== o.length) return { ok: false, message: `Expected ${e.length} values, got ${o.length}` };
      for (let i = 0; i < e.length; i++) {
        const a = Number(e[i]);
        const b = Number(o[i]);
        if (Number.isNaN(a) || Number.isNaN(b)) {
          if (e[i] !== o[i]) return { ok: false, message: firstDiff(e, o, 'token') };
          continue;
        }
        const err = Math.abs(a - b);
        if (err > tol && err > tol * Math.abs(a)) {
          return { ok: false, message: `Value ${i + 1}: expected ${e[i]}, got ${o[i]} (tolerance ${tol})` };
        }
      }
      return { ok: true };
    }
    case 'unordered': {
      const e = normLines(expected).split('\n').sort();
      const o = normLines(output).split('\n').sort();
      return e.length === o.length && e.every((l, i) => l === o[i])
        ? { ok: true }
        : { ok: false, message: 'Lines differ (order ignored)' };
    }
    default:
      return { ok: false, message: 'Unknown checker' };
  }
}

/** Python harness for custom checkers: reads {code,input,expected,output} JSON on stdin. */
export const CUSTOM_CHECKER_HARNESS = `
import sys, json
d = json.load(sys.stdin)
ns = {}
exec(compile(d["code"], "checker.py", "exec"), ns)
try:
    r = ns["check"](d["input"], d["expected"], d["output"])
except Exception as e:
    r = (False, "Checker rejected output: %s" % e)
if isinstance(r, tuple):
    ok, msg = bool(r[0]), str(r[1]) if len(r) > 1 else ""
else:
    ok, msg = bool(r), ""
print(json.dumps({"ok": ok, "message": msg}))
`;
