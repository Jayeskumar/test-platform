import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { after, before, describe, test } from 'node:test';
import { buildApp } from '../src/app.js';
import { getDb, now } from '../src/db/index.js';
import { createContest } from '../src/routes/contests.js';
import { createQuestion } from '../src/routes/library.js';
import { backfillEditorials } from '../src/seed/index.js';
import { EDITORIALS } from '../src/seed/editorials.js';
import { PROBLEMS } from '../src/seed/problems.js';
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

const REF = 'a, b = map(int, input().split())\nprint(a + b)';
const Q = (title: string, extra: Record<string, unknown> = {}) => ({
  type: 'coding', title, difficulty: 'easy', tags: [], visibility: 'public', statement: title,
  data: { limits: { timeMs: 1000, memoryMb: 128 }, checker: { type: 'tokens' }, reference: { language: 'python', code: REF }, ...extra },
  tests: [{ input: '1 2\n', expected: '', is_sample: true }, { input: '5 5\n', expected: '' }],
});

async function submit(slug: string, code: string, who: string) {
  const r = await req('POST', '/api/submissions', { slug, language: 'python', code, kind: 'submit' }, who);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  await getService().waitFor(r.body.id);
}

describe('hints and editorials', () => {
  before(async () => {
    await freshEnv();
    app = await buildApp();
    await createQuestion({ ...Q('Learn Sum', { hints: ['Read two numbers.', '  ', 'Add them.'], editorial: 'Add **a** and **b**.' }), slug: 'learn-sum' }, null);
    await createQuestion({ ...Q('Bare Sum'), slug: 'bare-sum' }, null);
    await createQuestion({ ...Q('Live Sum', { hints: ['h'], editorial: 'e' }), slug: 'live-sum' }, null);
    await req('POST', '/api/auth/register', { email: 'staff@l.dev', name: 'Staff', password: 'password1', role: 'recruiter' }, 'staff');
    await req('POST', '/api/auth/register', { email: 'lee@l.dev', name: 'Lee', password: 'password1' }, 'lee');
  });
  after(async () => { await app.close(); });

  test('every built-in coding and SQL problem has hints and an editorial', () => {
    for (const p of PROBLEMS.filter((x) => x.type !== 'mcq')) {
      const e = EDITORIALS[p.slug];
      assert.ok(e, `${p.slug} has learning material`);
      assert.ok(e.hints.length >= 2 && e.editorial.length > 100, `${p.slug} material is substantial`);
    }
  });

  test('the problem page advertises help without revealing it', async () => {
    const p = await req('GET', '/api/problems/learn-sum');
    assert.deepEqual(p.body.problem.learn, { hints: 2, editorial: true }, 'blank hints are dropped on save');
    assert.ok(!JSON.stringify(p.body).includes('Read two numbers'));
    const anon = await req('GET', '/api/problems/learn-sum/learn');
    assert.equal(anon.body.hintCount, 2);
    assert.deepEqual(anon.body.hints, []);
    assert.equal(anon.body.editorial.unlocked, false);
    assert.equal((await req('POST', '/api/problems/learn-sum/hints/1')).status, 401);
  });

  test('hints are revealed in order and remembered', async () => {
    assert.equal((await req('POST', '/api/problems/learn-sum/hints/2', undefined, 'lee')).status, 409, 'cannot skip ahead');
    const h1 = await req('POST', '/api/problems/learn-sum/hints/1', undefined, 'lee');
    assert.equal(h1.body.hint, 'Read two numbers.');
    assert.equal((await req('POST', '/api/problems/learn-sum/hints/3', undefined, 'lee')).status, 404);
    await req('POST', '/api/problems/learn-sum/hints/2', undefined, 'lee');
    const state = await req('GET', '/api/problems/learn-sum/learn', undefined, 'lee');
    assert.deepEqual(state.body.hints, ['Read two numbers.', 'Add them.']);
  });

  test('the editorial opens after three attempts or an accepted solution', async () => {
    let e = await req('GET', '/api/problems/learn-sum/editorial', undefined, 'lee');
    assert.equal(e.status, 403);
    assert.match(e.body.error, /3 more submissions/);
    for (let i = 0; i < 2; i++) await submit('learn-sum', 'print(0)', 'lee');
    assert.equal((await req('GET', '/api/problems/learn-sum/editorial', undefined, 'lee')).status, 403);
    await submit('learn-sum', 'print(0)', 'lee');
    e = await req('GET', '/api/problems/learn-sum/editorial', undefined, 'lee');
    assert.equal(e.status, 200);
    assert.equal(e.body.editorial, 'Add **a** and **b**.');
    assert.equal(e.body.reference.code, REF);

    await req('POST', '/api/auth/register', { email: 'sol@l.dev', name: 'Sol', password: 'password1' }, 'sol');
    await submit('learn-sum', REF, 'sol');
    e = await req('GET', '/api/problems/learn-sum/editorial', undefined, 'sol');
    assert.equal(e.status, 200);
    assert.match(e.body.reason, /accepted/);
    assert.equal((await req('GET', '/api/problems/learn-sum/editorial', undefined, 'staff')).status, 200, 'staff always');
    assert.equal((await req('GET', '/api/problems/bare-sum/editorial', undefined, 'staff')).status, 404);
  });

  test('withheld while the problem is in a running contest', async () => {
    const owner = getDb().get<any>("SELECT id FROM users WHERE email = 'staff@l.dev'").id;
    const live = getDb().get<any>("SELECT id FROM questions WHERE slug = 'live-sum'").id;
    createContest({ title: 'Live Round', startsAt: now() - 60_000, durationMin: 60, problems: [live] }, owner);
    const s = await req('GET', '/api/problems/live-sum/learn', undefined, 'lee');
    assert.match(s.body.blocked, /Live Round/);
    assert.deepEqual(s.body.hints, []);
    assert.equal((await req('POST', '/api/problems/live-sum/hints/1', undefined, 'lee')).status, 403);
    assert.equal((await req('GET', '/api/problems/live-sum/editorial', undefined, 'lee')).status, 403);
  });

  test('library validation and the backfill for older databases', async () => {
    const bad = await req('POST', '/api/library/questions', { ...Q('Too Many Hints', { hints: Array(11).fill('x') }) }, 'staff');
    assert.equal(bad.status, 400);
    assert.match(bad.body.error, /at most 10 hints/);

    const pid = await createQuestion({ ...Q('Pair Sum Count'), slug: 'pair-sum-count' }, null);
    getDb().run('UPDATE questions SET data = ? WHERE id = ?', JSON.stringify({ reference: { language: 'python', code: REF } }), pid);
    backfillEditorials(() => {});
    const data = JSON.parse(getDb().get<any>('SELECT data FROM questions WHERE id = ?', pid).data);
    assert.equal(data.hints.length, EDITORIALS['pair-sum-count'].hints.length);
    assert.equal(data.reference.code, REF, 'existing data is kept');
  });
});
