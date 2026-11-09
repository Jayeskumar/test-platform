import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { HttpError, requireStaff } from '../auth.js';
import { getDb, now, parseJson } from '../db/index.js';
import { fullQuestion } from '../questions.js';
import { getService, type QuestionRow } from '../service.js';

const TestCase = z.object({
  input: z.string().max(5_000_000),
  expected: z.string().max(5_000_000).default(''),
  is_sample: z.boolean().default(false),
  weight: z.number().min(0).max(100).default(1),
  explanation: z.string().max(5000).default(''),
});

const QuestionBody = z.object({
  slug: z.string().trim().regex(/^[a-z0-9-]+$/, 'use lowercase letters, digits and dashes').max(80).optional(),
  type: z.enum(['coding', 'mcq', 'sql']),
  title: z.string().trim().min(3).max(120),
  difficulty: z.enum(['easy', 'medium', 'hard']),
  tags: z.array(z.string().trim().min(1).max(30)).max(10).default([]),
  statement: z.string().min(1).max(50_000),
  visibility: z.enum(['public', 'private']).default('private'),
  data: z.record(z.any()).default({}),
  tests: z.array(TestCase).max(200).default([]),
});

type QuestionInput = z.infer<typeof QuestionBody>;

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'question';

/** Fill in missing expected outputs from the reference solution and validate type-specific data. */
async function prepare(q: QuestionInput): Promise<QuestionInput> {
  const svc = getService();
  if (q.type === 'mcq') {
    const opts = (q.data.options ?? []) as { id: string; text: string }[];
    if (opts.length < 2) throw new HttpError(400, 'A multiple choice question needs at least two options.');
    const correct = (q.data.correct ?? []) as string[];
    if (!correct.length || !correct.every((c) => opts.some((o) => o.id === c))) throw new HttpError(400, 'Mark at least one correct option.');
    return { ...q, tests: [] };
  }
  if (!q.tests.length) throw new HttpError(400, 'Add at least one test case.');
  if (!q.tests.some((t) => t.is_sample)) q.tests[0].is_sample = true;
  if (q.type === 'sql') {
    if (!q.data.schema || !q.data.solution) throw new HttpError(400, 'SQL questions need a schema and a reference solution.');
    try {
      const expected = await svc.judge.sqlExpected(q.data.schema, q.tests.map((t) => t.input), q.data.solution);
      return { ...q, tests: q.tests.map((t, i) => ({ ...t, expected: expected[i] })) };
    } catch (e: any) {
      throw new HttpError(400, e.message);
    }
  }
  const missing = q.tests.map((t, i) => (t.expected.trim() === '' ? i : -1)).filter((i) => i >= 0);
  if (missing.length) {
    const ref = q.data.reference as { language: string; code: string } | undefined;
    if (!ref?.code) throw new HttpError(400, `Test ${missing[0] + 1} has no expected output and there is no reference solution to compute it.`);
    try {
      const outs = await svc.judge.expectedOutputs(ref.language, ref.code, missing.map((i) => q.tests[i].input), {
        timeMs: (q.data.limits?.timeMs ?? 2000) * 5,
        memoryMb: q.data.limits?.memoryMb ?? 256,
      });
      const tests = [...q.tests];
      missing.forEach((i, k) => (tests[i] = { ...tests[i], expected: outs[k] }));
      return { ...q, tests };
    } catch (e: any) {
      throw new HttpError(400, e.message);
    }
  }
  return q;
}

export function saveQuestion(q: QuestionInput, authorId: number | null, id?: number): number {
  const db = getDb();
  return db.tx(() => {
    const t = now();
    let qid = id;
    if (qid) {
      db.run(
        'UPDATE questions SET type = ?, title = ?, difficulty = ?, tags = ?, statement = ?, data = ?, visibility = ?, updated_at = ? WHERE id = ?',
        q.type, q.title, q.difficulty, JSON.stringify(q.tags), q.statement, JSON.stringify(q.data), q.visibility, t, qid,
      );
      db.run('DELETE FROM test_cases WHERE question_id = ?', qid);
    } else {
      let slug = q.slug ?? slugify(q.title);
      for (let n = 2; db.get('SELECT 1 FROM questions WHERE slug = ?', slug); n++) slug = `${q.slug ?? slugify(q.title)}-${n}`;
      qid = db.run(
        `INSERT INTO questions (slug, type, title, difficulty, tags, statement, data, author_id, visibility, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        slug, q.type, q.title, q.difficulty, JSON.stringify(q.tags), q.statement, JSON.stringify(q.data), authorId, q.visibility, t, t,
      ).id;
    }
    q.tests.forEach((tc, i) => {
      db.run(
        'INSERT INTO test_cases (question_id, ord, input, expected, is_sample, weight, explanation) VALUES (?, ?, ?, ?, ?, ?, ?)',
        qid!, i, tc.input, tc.expected, tc.is_sample ? 1 : 0, tc.weight, tc.explanation,
      );
    });
    return qid!;
  });
}

export async function createQuestion(body: unknown, authorId: number | null) {
  const q = await prepare(QuestionBody.parse(body));
  return saveQuestion(q, authorId);
}

export async function libraryRoutes(app: FastifyInstance) {
  app.get('/api/library/questions', async (req) => {
    requireStaff(req);
    const rows = getDb().all<any>(
      `SELECT q.id, q.slug, q.type, q.title, q.difficulty, q.tags, q.visibility, q.updated_at, u.name AS author,
        (SELECT COUNT(*) FROM test_cases t WHERE t.question_id = q.id) AS tests,
        (SELECT COUNT(*) FROM assessment_questions aq WHERE aq.question_id = q.id) AS used_in
       FROM questions q LEFT JOIN users u ON u.id = q.author_id ORDER BY q.updated_at DESC`,
    );
    return { questions: rows.map((r) => ({ ...r, tags: parseJson(r.tags, []) })) };
  });

  app.get('/api/library/questions/:id', async (req) => {
    requireStaff(req);
    const q = getDb().get<QuestionRow>('SELECT * FROM questions WHERE id = ?', Number((req.params as any).id));
    if (!q) throw new HttpError(404, 'Question not found.');
    return { question: fullQuestion(q) };
  });

  app.post('/api/library/questions', async (req) => {
    const user = requireStaff(req);
    const id = await createQuestion(req.body, user.id);
    return { id };
  });

  app.put('/api/library/questions/:id', async (req) => {
    requireStaff(req);
    const id = Number((req.params as any).id);
    if (!getDb().get('SELECT 1 FROM questions WHERE id = ?', id)) throw new HttpError(404, 'Question not found.');
    const q = await prepare(QuestionBody.parse(req.body));
    saveQuestion(q, null, id);
    return { id };
  });

  app.delete('/api/library/questions/:id', async (req) => {
    requireStaff(req);
    const id = Number((req.params as any).id);
    const used = getDb().get<any>('SELECT COUNT(*) AS n FROM assessment_questions WHERE question_id = ?', id).n;
    if (used) throw new HttpError(409, `This question is used in ${used} assessment(s). Remove it from them first.`);
    getDb().run('DELETE FROM questions WHERE id = ?', id);
    return { ok: true };
  });

  /** Authoring helper: run a program on inputs and return its outputs. */
  app.post('/api/library/run-reference', async (req) => {
    requireStaff(req);
    const body = z.object({
      language: z.string(),
      code: z.string().max(100_000),
      inputs: z.array(z.string().max(5_000_000)).min(1).max(100),
      timeMs: z.number().int().min(100).max(20_000).default(5000),
    }).parse(req.body);
    try {
      const outputs = await getService().judge.expectedOutputs(body.language, body.code, body.inputs, { timeMs: body.timeMs, memoryMb: 512 });
      return { outputs };
    } catch (e: any) {
      throw new HttpError(400, e.message);
    }
  });

  /** Check that the reference solution passes every stored test (catches bad test data). */
  app.post('/api/library/questions/:id/validate', async (req) => {
    requireStaff(req);
    const q = getDb().get<QuestionRow>('SELECT * FROM questions WHERE id = ?', Number((req.params as any).id));
    if (!q) throw new HttpError(404, 'Question not found.');
    const full = fullQuestion(q);
    const svc = getService();
    if (q.type === 'sql') {
      const o = await svc.judge.judgeSql({
        query: full.data.solution, schema: full.data.schema, ordered: !!full.data.ordered,
        tests: full.tests.map((t: any) => ({ input: t.input, expected: t.expected, weight: t.weight, sample: t.is_sample })),
      });
      return { verdict: o.verdict, passed: o.passed, total: o.total, results: o.results.map((r) => ({ index: r.index, verdict: r.verdict, message: r.message, timeMs: r.timeMs })) };
    }
    if (q.type !== 'coding' || !full.data.reference?.code) throw new HttpError(400, 'This question has no reference solution to validate.');
    const o = await svc.judge.judgeCode({
      language: full.data.reference.language,
      code: full.data.reference.code,
      limits: { timeMs: full.data.limits?.timeMs ?? 2000, memoryMb: full.data.limits?.memoryMb ?? 256 },
      checker: full.data.checker ?? { type: 'tokens' },
      tests: full.tests.map((t: any) => ({ input: t.input, expected: t.expected, weight: t.weight, sample: t.is_sample })),
      complexity: full.data.complexity?.generator ? { ...full.data.complexity, cacheKey: `q${q.id}` } : null,
    });
    return {
      verdict: o.verdict, passed: o.passed, total: o.total, compileOutput: o.compileOutput, complexity: o.complexity,
      results: o.results.map((r) => ({ index: r.index, verdict: r.verdict, message: r.message, timeMs: r.timeMs, memoryKb: r.memoryKb })),
    };
  });
}
