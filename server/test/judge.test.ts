import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';
import { checkBuiltin } from '../src/judge/checkers.js';
import { estimateComplexity } from '../src/judge/complexity.js';
import { compareTables, Judge } from '../src/judge/judge.js';
import { findMatches, fingerprints, normalizeTokens, similarity } from '../src/integrity/plagiarism.js';
import { available, testSandbox } from './helpers.js';

const SUM = [
  { input: '1 2\n', expected: '3\n', weight: 1, sample: true },
  { input: '1000000000 1000000000\n', expected: '2000000000\n', weight: 2, sample: false },
  { input: '-5 3\n', expected: '-2\n', weight: 1, sample: false },
];
const lim = { timeMs: 1000, memoryMb: 128 };

const SOLUTIONS: Record<string, string> = {
  python: 'a, b = map(int, input().split())\nprint(a + b)\n',
  javascript: 'const [a, b] = require("fs").readFileSync(0, "utf8").trim().split(/\\s+/).map(Number);\nconsole.log(a + b);\n',
  typescript: 'import { readFileSync } from "node:fs";\nconst [a, b]: number[] = readFileSync(0, "utf8").trim().split(/\\s+/).map(Number);\nconsole.log(a + b);\n',
  c: '#include <stdio.h>\nint main(void){long long a,b;scanf("%lld %lld",&a,&b);printf("%lld\\n",a+b);return 0;}\n',
  cpp: '#include <iostream>\nint main(){long long a,b;std::cin>>a>>b;std::cout<<a+b<<"\\n";}\n',
  java: 'import java.util.*;\npublic class Main{public static void main(String[] x){Scanner s=new Scanner(System.in);long a=s.nextLong(),b=s.nextLong();System.out.println(a+b);}}\n',
  go: 'package main\nimport "fmt"\nfunc main(){var a,b int64;fmt.Scan(&a,&b);fmt.Println(a+b)}\n',
  rust: 'use std::io::Read;\nfn main(){let mut s=String::new();std::io::stdin().read_to_string(&mut s).unwrap();let v:Vec<i64>=s.split_whitespace().map(|x|x.parse().unwrap()).collect();println!("{}",v[0]+v[1]);}\n',
};

describe('judge', () => {
  let judge: Judge;
  before(async () => { judge = new Judge(await testSandbox()); });

  for (const [lang, code] of Object.entries(SOLUTIONS)) {
    test(`accepts a correct ${lang} solution`, async (t) => {
      if (!(await available(lang))) return t.skip(`${lang} unavailable on this host`);
      const o = await judge.judgeCode({ language: lang, code, tests: SUM, limits: lim, checker: { type: 'tokens' } });
      assert.equal(o.verdict, 'AC', JSON.stringify(o.results.map((r) => [r.verdict, r.message])) + o.compileOutput);
      assert.equal(o.score, 1);
    });
  }

  test('wrong answers get partial, weighted credit', async () => {
    const o = await judge.judgeCode({ language: 'python', code: 'a, b = map(int, input().split())\nprint(a + b if a > 0 else 0)\n', tests: SUM, limits: lim, checker: { type: 'tokens' } });
    assert.equal(o.verdict, 'WA');
    assert.equal(o.passed, 2);
    assert.equal(o.score, 3 / 4);
  });

  test('reports compilation errors', async () => {
    const o = await judge.judgeCode({ language: 'cpp', code: 'int main() { return x; }', tests: SUM, limits: lim, checker: { type: 'tokens' } });
    assert.equal(o.verdict, 'CE');
    assert.match(o.compileOutput, /x/);
  });

  test('reports runtime errors with the exception', async () => {
    const o = await judge.judgeCode({ language: 'python', code: 'raise ValueError("boom")', tests: SUM.slice(0, 1), limits: lim, checker: { type: 'tokens' } });
    assert.equal(o.verdict, 'RE');
    assert.match(o.results[0].message ?? '', /ValueError: boom/);
  });

  test('reports time limit exceeded', async () => {
    const o = await judge.judgeCode({ language: 'c', code: 'int main(){volatile long x=0;for(;;)x++;}', tests: SUM.slice(0, 1), limits: { timeMs: 300, memoryMb: 64 }, checker: { type: 'tokens' } });
    assert.equal(o.verdict, 'TLE');
  });

  test('custom input runs without grading', async () => {
    const o = await judge.judgeCode({ language: 'python', code: SOLUTIONS.python, tests: [{ input: '40 2\n', expected: '', weight: 0, sample: true, custom: true }], limits: lim, checker: { type: 'tokens' } });
    assert.equal(o.results[0].verdict, 'OK');
    assert.equal(o.results[0].output?.trim(), '42');
  });

  test('custom checker accepts any valid answer', async () => {
    const checker = { type: 'custom' as const, code: 'def check(i, e, o):\n    a, b = map(int, i.split())\n    x, y = map(int, o.split())\n    return (x + y == a + b, "pair must sum to a+b")' };
    const ok = await judge.judgeCode({ language: 'python', code: 'a, b = map(int, input().split())\nprint(a + b, 0)', tests: SUM.slice(0, 1), limits: lim, checker });
    assert.equal(ok.verdict, 'AC');
    const bad = await judge.judgeCode({ language: 'python', code: 'print(1, 1)', tests: [{ input: '5 5\n', expected: '', weight: 1, sample: true }], limits: lim, checker });
    assert.equal(bad.verdict, 'WA');
    assert.equal(bad.results[0].message, 'pair must sum to a+b');
  });

  test('expected outputs are returned in full, not truncated', async () => {
    const [out] = await judge.expectedOutputs('python', 'print("\\n".join(str(i) for i in range(50000)))', ['']);
    assert.equal(out.trim().split('\n').length, 50000);
  });

  test('SQL: judged against datasets, with ATTACH blocked', async () => {
    const schema = 'CREATE TABLE t (g TEXT, v INTEGER);';
    const data = "INSERT INTO t VALUES ('a', 1), ('a', 3), ('b', 5);";
    const [exp] = await judge.sqlExpected(schema, [data], 'SELECT g, AVG(v) FROM t GROUP BY g ORDER BY g');
    const ok = await judge.judgeSql({ query: 'select g, sum(v) * 1.0 / count(*) from t group by g order by 1;', schema, ordered: true, tests: [{ input: data, expected: exp, weight: 1, sample: true }] });
    assert.equal(ok.verdict, 'AC');
    const wrong = await judge.judgeSql({ query: 'select g, max(v) from t group by g order by 1', schema, ordered: true, tests: [{ input: data, expected: exp, weight: 1, sample: true }] });
    assert.equal(wrong.verdict, 'WA');
    const attach = await judge.judgeSql({ query: "ATTACH '/etc/passwd' AS p", schema, ordered: true, tests: [{ input: data, expected: exp, weight: 1, sample: true }] });
    assert.equal(attach.verdict, 'RE');
  });

  test('complexity analysis tells linear from quadratic', async () => {
    const gen = 'def generate(n):\n    return str(n) + "\\n" + " ".join(str(random.randint(1, 10**9)) for _ in range(n))';
    const tests = [{ input: '3\n3 1 2\n', expected: '1 2 3\n', weight: 1, sample: true }];
    const cx = { generator: gen, sizes: [500, 1000, 2000, 4000, 8000], expected: 'O(n log n)', cacheKey: 'test' };
    const quad = 'n = int(input())\na = list(map(int, input().split()))\nfor i in range(n):\n    m = i\n    for k in range(i + 1, n):\n        if a[k] < a[m]: m = k\n    a[i], a[m] = a[m], a[i]\nprint(*a)';
    const slow = await judge.judgeCode({ language: 'python', code: quad, tests, limits: lim, checker: { type: 'tokens' }, complexity: cx });
    assert.equal(slow.verdict, 'AC');
    assert.equal(slow.complexity?.meetsTarget, false, JSON.stringify(slow.complexity));
    assert.match(slow.complexity!.estimate + (slow.complexity!.note ?? ''), /n\^2|n\^3|time budget/);
  });
});

describe('checkers', () => {
  test('exact ignores trailing whitespace only', () => {
    assert.ok(checkBuiltin({ type: 'exact' }, 'a b\nc\n', 'a b  \nc').ok);
    assert.ok(!checkBuiltin({ type: 'exact' }, 'a b\n', 'a  b\n').ok);
  });
  test('tokens ignores all whitespace layout', () => assert.ok(checkBuiltin({ type: 'tokens' }, '1 2\n3', '1\n2 3\n').ok));
  test('float tolerance', () => {
    assert.ok(checkBuiltin({ type: 'float', tolerance: 1e-6 }, '3.1415926', '3.14159265').ok);
    assert.ok(!checkBuiltin({ type: 'float', tolerance: 1e-6 }, '3.14', '3.15').ok);
  });
  test('unordered lines', () => assert.ok(checkBuiltin({ type: 'unordered' }, 'a\nb\nc', 'c\na\nb\n').ok));
  test('helpful mismatch messages', () => assert.match(checkBuiltin({ type: 'tokens' }, '1 2 3', '1 5 3').message!, /token 2.*"2".*"5"/));
  test('SQL table comparison', () => {
    const a = { columns: ['x'], rows: [[1], [2.0000001]] };
    assert.ok(compareTables(a, { columns: ['y'], rows: [[1], [2]] }, true).ok);
    assert.ok(!compareTables(a, { columns: ['y'], rows: [[2], [1]] }, true).ok);
    assert.ok(compareTables(a, { columns: ['y'], rows: [[2], [1]] }, false).ok);
  });
});

describe('complexity estimator', () => {
  const pts = (f: (n: number) => number) => [10000, 20000, 40000, 80000, 160000].map((n) => ({ n, cpuMs: Math.round(25 + f(n)), status: 'OK' }));
  test('linear', () => assert.equal(estimateComplexity(pts((n) => n / 400), 'O(n)').estimate, 'O(n)'));
  test('quadratic', () => assert.equal(estimateComplexity(pts((n) => (n * n) / 2e7), 'O(n)').estimate, 'O(n^2)'));
  test('square root', () => assert.equal(estimateComplexity(pts((n) => Math.sqrt(n)), 'O(n)').estimate, 'O(√n)'));
  test('timeouts fail the target', () => {
    const r = estimateComplexity([...pts((n) => n / 400).slice(0, 3), { n: 80000, cpuMs: 4000, status: 'TLE' }], 'O(n)');
    assert.equal(r.meetsTarget, false);
  });
});

describe('plagiarism', () => {
  const a = `def solve(nums, target):\n    seen = {}\n    count = 0\n    for x in nums:\n        count += seen.get(target - x, 0)\n        seen[x] = seen.get(x, 0) + 1\n    return count\n\nprint(solve(list(map(int, input().split())), int(input())))\n`;
  const renamed = `# my own solution!\ndef calc(arr, goal):\n    memo = {}\n    total = 0\n    for v in arr:\n        total += memo.get(goal - v, 0)\n        memo[v] = memo.get(v, 0) + 1\n    return total\n\nprint(calc(list(map(int, input().split())), int(input())))\n`;
  const different = `import sys\nfrom itertools import combinations\nvals = list(map(int, sys.stdin.readline().split()))\nt = int(sys.stdin.readline())\nprint(sum(1 for p, q in combinations(vals, 2) if p + q == t))\n`;
  test('normalization removes identifiers and comments', () => assert.deepEqual(normalizeTokens(a), normalizeTokens(renamed)));
  test('renamed copy is detected', () => assert.equal(similarity(fingerprints(a), fingerprints(renamed)), 1));
  test('independent solution is not flagged', () => {
    assert.ok(similarity(fingerprints(a), fingerprints(different)) < 0.3);
    assert.equal(findMatches([{ id: '1', label: 'A', code: a }, { id: '2', label: 'B', code: different }]).length, 0);
  });
});
