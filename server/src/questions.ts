import { getDb, parseJson } from './db/index.js';
import type { QuestionRow } from './service.js';

/** A question as shown to someone solving it (no answers, no hidden tests). */
export function publicQuestion(q: QuestionRow) {
  const db = getDb();
  const data = parseJson<any>(q.data, {});
  const base = {
    id: q.id,
    slug: q.slug,
    type: q.type,
    title: q.title,
    difficulty: q.difficulty,
    tags: parseJson<string[]>(q.tags, []),
    statement: q.statement,
  };
  const counts = db.get<any>('SELECT COUNT(*) AS n, COALESCE(SUM(weight),0) AS w FROM test_cases WHERE question_id = ?', q.id);
  const samples = db
    .all<any>('SELECT id, input, expected, explanation FROM test_cases WHERE question_id = ? AND is_sample = 1 ORDER BY ord, id', q.id)
    .map((t) => ({ ...t, expectedTable: q.type === 'sql' ? parseJson(t.expected, null) : undefined }));
  if (q.type === 'coding') {
    return {
      ...base,
      limits: { timeMs: data.limits?.timeMs ?? 2000, memoryMb: data.limits?.memoryMb ?? 256 },
      checker: data.checker?.type ?? 'tokens',
      starter: data.starter ?? {},
      languages: data.languages ?? null,
      complexity: data.complexity ? { expected: data.complexity.expected, sizes: data.complexity.sizes } : null,
      samples,
      testCount: counts.n,
    };
  }
  if (q.type === 'sql') {
    return { ...base, schema: data.schema ?? '', ordered: !!data.ordered, samples, testCount: counts.n };
  }
  return {
    ...base,
    options: (data.options ?? []) as { id: string; text: string }[],
    multiple: !!data.multiple,
  };
}

/** The full question for authors (includes all tests and solutions). */
export function fullQuestion(q: QuestionRow) {
  const db = getDb();
  return {
    id: q.id,
    slug: q.slug,
    type: q.type,
    title: q.title,
    difficulty: q.difficulty,
    tags: parseJson<string[]>(q.tags, []),
    statement: q.statement,
    visibility: q.visibility,
    data: parseJson<any>(q.data, {}),
    tests: db.all<any>('SELECT id, ord, input, expected, is_sample, weight, explanation FROM test_cases WHERE question_id = ? ORDER BY ord, id', q.id)
      .map((t) => ({ ...t, is_sample: !!t.is_sample })),
  };
}

/** Strip hidden-test details from a submission unless the viewer is staff. */
export function presentSubmission(sub: any, opts: { staff: boolean }) {
  if (!sub) return sub;
  const results = parseJson<any[]>(sub.results, []).map((r) => {
    if (opts.staff || r.sample || r.custom) return r;
    const { input, expected, output, stderr, table, expectedTable, ...rest } = r;
    const message = r.verdict === 'WA' ? 'Hidden test case — output did not match.' : r.message;
    return { ...rest, message, hidden: true };
  });
  return {
    id: sub.id,
    questionId: sub.question_id,
    attemptId: sub.attempt_id,
    language: sub.language,
    code: sub.code,
    kind: sub.kind,
    status: sub.status,
    verdict: sub.verdict,
    score: sub.score,
    passed: sub.passed,
    total: sub.total,
    timeMs: sub.time_ms,
    memoryKb: sub.memory_kb,
    compileOutput: sub.compile_output,
    results,
    complexity: parseJson(sub.complexity, null),
    createdAt: sub.created_at,
    finishedAt: sub.finished_at,
  };
}

export function presentTestEvent(r: any, staff: boolean) {
  return presentSubmission({ results: JSON.stringify([r]) }, { staff }).results[0];
}
