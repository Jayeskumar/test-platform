import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { after, before, describe, test } from 'node:test';
import { buildApp } from '../src/app.js';
import { getDb } from '../src/db/index.js';
import { createQuestion } from '../src/routes/library.js';
import { getService } from '../src/service.js';
import { freshEnv } from './helpers.js';

let app: FastifyInstance;
const cookies: Record<string, string> = {};

async function req(method: string, url: string, body?: unknown, who?: string) {
  const res = await app.inject({
    method: method as any, url, payload: body as any,
    headers: who && cookies[who] ? { cookie: cookies[who] } : {},
  });
  const set = res.headers['set-cookie'];
  if (who && set) cookies[who] = String(Array.isArray(set) ? set[0] : set).split(';')[0];
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
}

async function waitDone(id: number, who?: string, token?: string) {
  await getService().waitFor(id);
  return (await req('GET', `/api/submissions/${id}${token ? `?token=${token}` : ''}`, undefined, who)).body.submission;
}

const SUM_Q = {
  type: 'coding', title: 'Add Two Numbers', difficulty: 'easy', tags: ['math'], visibility: 'public',
  statement: 'Print a + b.',
  data: { limits: { timeMs: 1000, memoryMb: 128 }, checker: { type: 'tokens' }, reference: { language: 'python', code: 'a, b = map(int, input().split())\nprint(a + b)' } },
  tests: [
    { input: '1 2\n', expected: '', is_sample: true },
    { input: '40 2\n', expected: '' },
    { input: '-7 7\n', expected: '' },
  ],
};
const MCQ_Q = {
  type: 'mcq', title: 'Pick B', difficulty: 'easy', tags: [], visibility: 'private', statement: 'Pick b.',
  data: { options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], correct: ['b'] },
};

describe('HTTP API', () => {
  let qid = 0;
  let mcqId = 0;
  before(async () => {
    await freshEnv();
    app = await buildApp();
    qid = await createQuestion(SUM_Q, null);
    mcqId = await createQuestion(MCQ_Q, null);
  });
  after(async () => { await app.close(); });

  test('registration, login and session', async () => {
    let r = await req('POST', '/api/auth/register', { email: 'cand@x.dev', name: 'Cand', password: 'password1' }, 'cand');
    assert.equal(r.status, 200);
    assert.equal(r.body.user.role, 'candidate');
    r = await req('POST', '/api/auth/register', { email: 'cand@x.dev', name: 'Dup', password: 'password1' });
    assert.equal(r.status, 409);
    r = await req('POST', '/api/auth/register', { email: 'bad', name: 'x', password: 'short' });
    assert.equal(r.status, 400);
    await req('POST', '/api/auth/register', { email: 'rec@x.dev', name: 'Rec', password: 'password1', role: 'recruiter' }, 'rec');
    await req('POST', '/api/auth/register', { email: 'rec2@x.dev', name: 'Rec2', password: 'password1', role: 'recruiter' }, 'rec2');
    r = await req('POST', '/api/auth/login', { email: 'rec@x.dev', password: 'wrong' });
    assert.equal(r.status, 401);
    r = await req('GET', '/api/auth/me', undefined, 'rec');
    assert.equal(r.body.user.email, 'rec@x.dev');
  });

  test('stored expected outputs were computed from the reference solution', () => {
    const rows = getDb().all<any>('SELECT expected FROM test_cases WHERE question_id = ? ORDER BY ord', qid);
    assert.deepEqual(rows.map((r) => r.expected.trim()), ['3', '42', '0']);
  });

  test('practice: list, view without answers, run and submit', async () => {
    const list = await req('GET', '/api/problems', undefined, 'cand');
    assert.ok(list.body.problems.some((p: any) => p.id === qid));
    assert.ok(!list.body.problems.some((p: any) => p.id === mcqId), 'private questions are not listed');
    const p = await req('GET', '/api/problems/add-two-numbers', undefined, 'cand');
    assert.equal(p.body.problem.samples.length, 1);
    assert.equal(p.body.problem.data, undefined, 'no reference solution leaks');

    const anon = await req('POST', '/api/submissions', { questionId: qid, language: 'python', code: 'print(1)', kind: 'run' });
    assert.equal(anon.status, 401);

    const run = await req('POST', '/api/submissions', { questionId: qid, language: 'python', code: 'a, b = map(int, input().split())\nprint(a + b)', kind: 'run', customInput: '5 5\n' }, 'cand');
    const runSub = await waitDone(run.body.id, 'cand');
    assert.equal(runSub.results.length, 2, 'samples + custom input only');
    assert.equal(runSub.results[1].output.trim(), '10');

    const sub = await req('POST', '/api/submissions', { questionId: qid, language: 'python', code: 'a, b = map(int, input().split())\nprint(a + b if a > 0 else 1)', kind: 'submit' }, 'cand');
    const done = await waitDone(sub.body.id, 'cand');
    assert.equal(done.verdict, 'WA');
    const hidden = done.results.filter((r: any) => !r.sample);
    assert.equal(hidden.length, 2);
    for (const h of hidden) {
      assert.equal(h.hidden, true);
      assert.equal(h.input, undefined, 'hidden input must not leak');
      assert.equal(h.expected, undefined, 'hidden expected output must not leak');
      assert.equal(h.output, undefined);
    }
    // Another user cannot read this submission.
    const other = await req('GET', `/api/submissions/${sub.body.id}`, undefined, 'rec2');
    assert.equal(other.status, 200, 'staff can audit submissions');
    const anonView = await req('GET', `/api/submissions/${sub.body.id}`);
    assert.equal(anonView.status, 404);
  });

  test('candidates cannot reach staff endpoints', async () => {
    for (const url of ['/api/assessments', '/api/library/questions', `/api/library/questions/${qid}`]) {
      assert.equal((await req('GET', url, undefined, 'cand')).status, 403, url);
      assert.equal((await req('GET', url)).status, 401, url);
    }
  });

  test('assessment flow: invite, take, autosave, events, submit, report', async () => {
    const created = await req('POST', '/api/assessments', {
      title: 'Screen', durationMin: 30, questions: [{ questionId: qid, points: 100 }, { questionId: mcqId, points: 20 }],
    }, 'rec');
    assert.equal(created.status, 200);
    const aid = created.body.id;
    const inv = await req('POST', `/api/assessments/${aid}/invites`, { candidates: [{ email: 'a@x.dev', name: 'Alice' }, { email: 'b@x.dev' }] }, 'rec');
    const [alice, bob] = inv.body.invites;

    // Other recruiters cannot see this assessment or its attempts.
    assert.equal((await req('GET', `/api/assessments/${aid}`, undefined, 'rec2')).status, 404);
    assert.equal((await req('GET', `/api/attempts/${alice.id}`, undefined, 'rec2')).status, 404);

    let t = await req('GET', `/api/take/${alice.token}`);
    assert.equal(t.body.attempt.status, 'invited');
    assert.equal(t.body.questions, undefined, 'questions hidden until start');
    assert.equal((await req('GET', '/api/take/not-a-token')).status, 404);
    assert.equal((await req('PUT', `/api/take/${alice.token}/answers/${qid}`, { code: 'x' })).status, 409, 'must start first');

    await req('POST', `/api/take/${alice.token}/start`, { name: 'Alice A.' });
    t = await req('GET', `/api/take/${alice.token}`);
    assert.equal(t.body.attempt.status, 'in_progress');
    assert.equal(t.body.questions.length, 2);
    const mcq = t.body.questions.find((q: any) => q.type === 'mcq');
    assert.equal(mcq.correct, undefined, 'MCQ answers are not sent to candidates');

    // Autosave twice creates two snapshots; MCQ answer.
    await req('PUT', `/api/take/${alice.token}/answers/${qid}`, { language: 'python', code: 'a, b = map(int, input().split())' });
    await req('PUT', `/api/take/${alice.token}/answers/${qid}`, { language: 'python', code: 'a, b = map(int, input().split())\nprint(a + b)' });
    await req('PUT', `/api/take/${alice.token}/answers/${mcqId}`, { choice: 'b' });
    await req('POST', `/api/take/${alice.token}/events`, { events: [{ type: 'tab_hidden' }, { type: 'paste', questionId: qid, detail: { chars: 12 } }] });
    assert.equal((await req('POST', `/api/take/${alice.token}/events`, { events: [{ type: 'hack' }] })).status, 400);

    // A question outside the assessment is rejected.
    const foreign = await createQuestion({ ...SUM_Q, title: 'Other' }, null);
    assert.equal((await req('POST', '/api/submissions', { questionId: foreign, language: 'python', code: 'print(1)', kind: 'run', attemptToken: alice.token })).status, 403);

    // Bob's token cannot read Alice's submissions.
    // Running code also saves it as the current answer (it is what's in the editor).
    const run = await req('POST', '/api/submissions', { questionId: qid, language: 'python', code: 'a, b = map(int, input().split())\nprint(a + b)', kind: 'run', attemptToken: alice.token });
    await getService().waitFor(run.body.id);
    await req('POST', `/api/take/${bob.token}/start`, { name: 'Bob' });
    assert.equal((await req('GET', `/api/submissions/${run.body.id}?token=${bob.token}`)).status, 404);
    assert.equal((await req('GET', `/api/submissions/${run.body.id}?token=${alice.token}`)).status, 200);

    // Finish without ever pressing submit: the saved code is judged automatically.
    const fin = await req('POST', `/api/take/${alice.token}/submit`);
    assert.equal(fin.status, 200);
    t = await req('GET', `/api/take/${alice.token}`);
    assert.equal(t.body.attempt.status, 'submitted');
    assert.equal(t.body.attempt.score, undefined, 'score hidden from candidate by default');
    assert.equal((await req('PUT', `/api/take/${alice.token}/answers/${qid}`, { code: 'late' })).status, 410);

    const rep = await req('GET', `/api/attempts/${alice.id}`, undefined, 'rec');
    assert.equal(rep.status, 200);
    assert.equal(rep.body.attempt.score, 120);
    const coding = rep.body.questions.find((q: any) => q.id === qid);
    assert.equal(coding.best.verdict, 'AC');
    assert.equal(coding.snapshots.length, 2);
    assert.ok(coding.best.results.every((r: any) => r.input !== undefined), 'staff see hidden test details');
    assert.equal(rep.body.integrity.counts.tab_hidden, 1);

    const list = await req('GET', `/api/assessments/${aid}`, undefined, 'rec');
    assert.equal(list.body.attempts.length, 2);
    assert.equal(list.body.attempts[0].name, 'Alice A.');
  });

  test('expired attempts are finalized', async () => {
    const created = await req('POST', '/api/assessments', { title: 'Quick', durationMin: 5, questions: [{ questionId: mcqId, points: 10 }] }, 'rec');
    const [inv] = (await req('POST', `/api/assessments/${created.body.id}/invites`, { candidates: [{ email: 'late@x.dev' }] }, 'rec')).body.invites;
    await req('POST', `/api/take/${inv.token}/start`, { name: 'Late' });
    await req('PUT', `/api/take/${inv.token}/answers/${mcqId}`, { choice: 'b' });
    getDb().run('UPDATE attempts SET deadline_at = ? WHERE id = ?', Date.now() - 60_000, inv.id);
    const r = await req('PUT', `/api/take/${inv.token}/answers/${mcqId}`, { choice: 'a' });
    assert.equal(r.status, 410);
    const t = await req('GET', `/api/take/${inv.token}`);
    assert.equal(t.body.attempt.status, 'submitted');
    const a = getDb().get<any>('SELECT score FROM attempts WHERE id = ?', inv.id);
    assert.equal(a.score, 10, 'answer saved before the deadline counts');
  });

  test('library validation rejects broken questions', async () => {
    const r = await req('POST', '/api/library/questions', { ...SUM_Q, title: 'Broken', data: { ...SUM_Q.data, reference: { language: 'python', code: 'raise SystemExit(1)' } } }, 'rec');
    assert.equal(r.status, 400);
    assert.match(r.body.error, /Reference solution failed/);
    const m = await req('POST', '/api/library/questions', { ...MCQ_Q, data: { options: [{ id: 'a', text: 'x' }], correct: ['a'] } }, 'rec');
    assert.equal(m.status, 400);
  });
});

describe('reviewer workflow', () => {
  before(async () => {
    await freshEnv();
    app = await buildApp();
  });
  after(async () => { await app.close(); });

  test('decisions, overview and comparison', async () => {
    await req('POST', '/api/auth/register', { email: 'r@w.dev', name: 'Reviewer', password: 'password1', role: 'recruiter' }, 'rw');
    await req('POST', '/api/auth/register', { email: 'o@w.dev', name: 'Other', password: 'password1', role: 'recruiter' }, 'ow');
    const q = await createQuestion(MCQ_Q, null);
    const a = (await req('POST', '/api/assessments', { title: 'Flow', durationMin: 10, questions: [{ questionId: q, points: 10 }] }, 'rw')).body.id;
    const invs = (await req('POST', `/api/assessments/${a}/invites`, { candidates: [{ email: 'x@w.dev' }, { email: 'y@w.dev' }] }, 'rw')).body.invites;
    for (const [i, inv] of invs.entries()) {
      await req('POST', `/api/take/${inv.token}/start`, { name: `C${i}` });
      await req('PUT', `/api/take/${inv.token}/answers/${q}`, { choice: i === 0 ? 'b' : 'a' });
      await req('POST', `/api/take/${inv.token}/submit`);
    }
    let ov = await req('GET', '/api/hiring/overview', undefined, 'rw');
    assert.equal(ov.body.stats.awaitingReview, 2);
    assert.equal(ov.body.awaitingReview.length, 2);
    assert.equal((await req('GET', '/api/hiring/overview', undefined, 'ow')).body.stats.awaitingReview, 0, 'scoped to owner');

    assert.equal((await req('PUT', `/api/attempts/${invs[0].id}/review`, { decision: 'advance', notes: 'Strong.' }, 'ow')).status, 404);
    assert.equal((await req('PUT', `/api/attempts/${invs[0].id}/review`, { decision: 'maybe' }, 'rw')).status, 400);
    const r = await req('PUT', `/api/attempts/${invs[0].id}/review`, { decision: 'advance', notes: 'Strong.' }, 'rw');
    assert.equal(r.status, 200);
    ov = await req('GET', '/api/hiring/overview', undefined, 'rw');
    assert.equal(ov.body.stats.awaitingReview, 1);

    const detail = await req('GET', `/api/assessments/${a}`, undefined, 'rw');
    const first = detail.body.attempts.find((x: any) => x.id === invs[0].id);
    assert.equal(first.decision, 'advance');
    assert.equal(first.decidedBy, 'Reviewer');
    assert.equal(first.scores[q], 10);

    const cmp = await req('GET', `/api/assessments/${a}/compare?ids=${invs[0].id},${invs[1].id}`, undefined, 'rw');
    assert.equal(cmp.body.candidates.length, 2);
    assert.equal(cmp.body.candidates[0].questions[0].score, 10);
    assert.equal(cmp.body.candidates[1].questions[0].score, 0);
    assert.equal((await req('GET', `/api/assessments/${a}/compare?ids=${invs[0].id}`, undefined, 'ow')).status, 404);
  });
});
