import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { after, before, describe, test } from 'node:test';
import { buildApp } from '../src/app.js';
import { computeStandings, type ContestRow } from '../src/contests.js';
import { getDb } from '../src/db/index.js';
import { createContest } from '../src/routes/contests.js';
import { createQuestion } from '../src/routes/library.js';
import { getService } from '../src/service.js';
import { freshEnv } from './helpers.js';

let app: FastifyInstance;
const cookies: Record<string, string> = {};
async function req(method: string, url: string, body?: unknown, who?: string) {
  const res = await app.inject({ method: method as any, url, payload: body as any, headers: who && cookies[who] ? { cookie: cookies[who] } : {} });
  const set = res.headers['set-cookie'];
  if (who && set) cookies[who] = String(Array.isArray(set) ? set[0] : set).split(';')[0];
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
}

const Q = (title: string) => ({
  type: 'coding', title, difficulty: 'easy', tags: [], visibility: 'private', statement: title,
  data: { limits: { timeMs: 1000, memoryMb: 128 }, checker: { type: 'tokens' }, reference: { language: 'python', code: 'a, b = map(int, input().split())\nprint(a + b)' } },
  tests: [{ input: '1 2\n', expected: '', is_sample: true }, { input: '5 5\n', expected: '' }],
});

describe('contests', () => {
  let qa = 0;
  let qb = 0;
  const users: Record<string, number> = {};
  before(async () => {
    await freshEnv();
    app = await buildApp();
    qa = await createQuestion(Q('Sum A'), null);
    qb = await createQuestion(Q('Sum B'), null);
    await req('POST', '/api/auth/register', { email: 'org@c.dev', name: 'Organizer', password: 'password1', role: 'recruiter' }, 'org');
    for (const n of ['alice', 'bob', 'carol']) {
      const r = await req('POST', '/api/auth/register', { email: `${n}@c.dev`, name: n, password: 'password1' }, n);
      users[n] = r.body.user.id;
    }
  });
  after(async () => { await app.close(); });

  test('ICPC standings: solved, penalty, attempts, first to solve, ties', () => {
    const start = Date.now() - 60 * 60_000;
    const { id } = createContest({ title: 'Scoring', startsAt: start, durationMin: 120, penaltyMin: 20, problems: [qa, qb] }, null);
    const c = getDb().get<ContestRow>('SELECT * FROM contests WHERE id = ?', id)!;
    const db = getDb();
    for (const u of Object.values(users)) db.run('INSERT INTO contest_entries (contest_id, user_id, joined_at) VALUES (?, ?, ?)', id, u, start);
    const sub = (u: number, q: number, verdict: string, min: number) =>
      db.run("INSERT INTO submissions (user_id, contest_id, question_id, language, code, kind, status, verdict, created_at) VALUES (?, ?, ?, 'python', '', 'submit', 'done', ?, ?)", u, id, q, verdict, start + min * 60_000 + 1000);
    // alice: A at 10 after one WA and one CE (CE ignored); B at 30. penalty = (10 + 20) + 30 = 60
    sub(users.alice, qa, 'WA', 5); sub(users.alice, qa, 'CE', 8); sub(users.alice, qa, 'AC', 10); sub(users.alice, qb, 'AC', 30);
    // bob: A at 7 (first to solve), B at 50. penalty = 57 → ranks above alice
    sub(users.bob, qa, 'AC', 7); sub(users.bob, qb, 'TLE', 20); sub(users.bob, qb, 'AC', 30);
    // carol: only wrong answers
    sub(users.carol, qb, 'WA', 3); sub(users.carol, qb, 'RE', 4);
    const s = computeStandings(c);
    assert.deepEqual(s.rows.map((r) => [r.name, r.rank, r.solved, r.penalty]), [['bob', 1, 2, 57], ['alice', 2, 2, 60], ['carol', 3, 0, 0]]);
    const alice = s.rows.find((r) => r.name === 'alice')!;
    assert.equal(alice.cells[qa].attempts, 1, 'CE does not count');
    assert.equal(alice.cells[qa].minute, 10);
    assert.equal(s.rows[0].cells[qa].firstToSolve, true);
    assert.equal(alice.cells[qb].firstToSolve, true, 'alice and bob both at minute 30 — alice submitted first');
    assert.equal(s.rows.find((r) => r.name === 'carol')!.cells[qb].attempts, 2);
    assert.deepEqual(s.problems.map((p) => [p.label, p.solvedBy, p.triedBy]), [['A', 2, 2], ['B', 2, 3]]);
  });

  test('freeze hides late results from participants but not from organizers', async () => {
    const start = Date.now() - 50 * 60_000;
    const { id, slug } = createContest({ title: 'Frozen', startsAt: start, durationMin: 60, freezeMin: 20, problems: [qa] }, getDb().get<any>("SELECT id FROM users WHERE email = 'org@c.dev'").id);
    const db = getDb();
    db.run('INSERT INTO contest_entries (contest_id, user_id, joined_at) VALUES (?, ?, ?)', id, users.alice, start);
    db.run("INSERT INTO submissions (user_id, contest_id, question_id, language, code, kind, status, verdict, created_at) VALUES (?, ?, ?, 'python', '', 'submit', 'done', 'AC', ?)", users.alice, id, qa, Date.now() - 60_000);
    const pub = await req('GET', `/api/contests/${slug}/standings`, undefined, 'bob');
    assert.equal(pub.body.frozen, true);
    assert.equal(pub.body.rows[0].solved, 0);
    assert.equal(pub.body.rows[0].cells[qa].pending, 1);
    const org = await req('GET', `/api/contests/${slug}/standings`, undefined, 'org');
    assert.equal(org.body.frozen, false);
    assert.equal(org.body.rows[0].solved, 1);
  });

  test('submissions: only while running, only for contest problems; problems hidden until start', async () => {
    const upcoming = createContest({ title: 'Soon', startsAt: Date.now() + 3600_000, durationMin: 60, problems: [qa] }, null);
    const ended = createContest({ title: 'Done', startsAt: Date.now() - 7200_000, durationMin: 60, problems: [qa] }, null);
    const running = createContest({ title: 'Live', startsAt: Date.now() - 60_000, durationMin: 60, problems: [qa] }, null);
    const code = 'a, b = map(int, input().split())\nprint(a + b)';
    assert.equal((await req('GET', `/api/contests/${upcoming.slug}/problems/A`, undefined, 'alice')).status, 403);
    assert.deepEqual((await req('GET', `/api/contests/${upcoming.slug}`, undefined, 'alice')).body.problems, []);
    assert.equal((await req('POST', '/api/submissions', { questionId: qa, language: 'python', code, kind: 'submit', contestSlug: upcoming.slug }, 'alice')).status, 409);
    assert.equal((await req('POST', '/api/submissions', { questionId: qa, language: 'python', code, kind: 'submit', contestSlug: ended.slug }, 'alice')).status, 409);
    assert.equal((await req('POST', '/api/submissions', { questionId: qb, language: 'python', code, kind: 'submit', contestSlug: running.slug }, 'alice')).status, 404);
    assert.equal((await req('POST', '/api/submissions', { questionId: qa, language: 'python', code, kind: 'submit', contestSlug: running.slug })).status, 401);
    // A private question cannot be practiced outside the contest.
    assert.equal((await req('POST', '/api/submissions', { questionId: qa, language: 'python', code, kind: 'submit' }, 'alice')).status, 404);

    // A real, judged submission auto-joins and lands on the standings.
    let updates = 0;
    const c = getDb().get<any>('SELECT id FROM contests WHERE slug = ?', running.slug);
    getService().on(`contest:${c.id}`, () => updates++);
    const sub = await req('POST', '/api/submissions', { questionId: qa, language: 'python', code, kind: 'submit', contestSlug: running.slug }, 'alice');
    assert.equal(sub.status, 200);
    await getService().waitFor(sub.body.id);
    assert.equal(updates, 1, 'standings listeners are notified');
    const st = await req('GET', `/api/contests/${running.slug}/standings`, undefined, 'bob');
    assert.equal(st.body.rows[0].name, 'alice');
    assert.equal(st.body.rows[0].solved, 1);
    const row = getDb().get<any>('SELECT complexity, contest_id FROM submissions WHERE id = ?', sub.body.id);
    assert.equal(row.contest_id, c.id);
    assert.equal(row.complexity, null);
    // Contest work does not count as practice.
    const stats = await req('GET', '/api/me/stats', undefined, 'alice');
    assert.equal(stats.body.solved.length, 0);
  });

  test('only staff create contests; MCQ rejected', async () => {
    const body = { title: 'Staff Cup', startsAt: Date.now(), durationMin: 30, problems: [qa] };
    assert.equal((await req('POST', '/api/contests', body, 'alice')).status, 403);
    assert.equal((await req('POST', '/api/contests', body, 'org')).status, 200);
    const mcq = await createQuestion({ type: 'mcq', title: 'Pick one', difficulty: 'easy', tags: [], statement: 'm', data: { options: [{ id: 'a', text: 'a' }, { id: 'b', text: 'b' }], correct: ['a'] } }, null);
    assert.equal((await req('POST', '/api/contests', { ...body, problems: [mcq] }, 'org')).status, 400);
  });
});
