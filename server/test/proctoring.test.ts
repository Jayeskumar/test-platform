import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { after, before, describe, test } from 'node:test';
import { buildApp } from '../src/app.js';
import { getDb } from '../src/db/index.js';
import { getMediaRoot, sweepRetention } from '../src/media.js';
import { drawQuestions } from '../src/proctor.js';
import { createQuestion } from '../src/routes/library.js';
import { computeIntegrity } from '../src/scoring.js';
import { freshEnv } from './helpers.js';

let app: FastifyInstance;
let staff = '';
let otherStaff = '';

// Smallest valid JPEG/PNG headers followed by filler: the server checks magic bytes, not pixels.
const JPEG = `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1)]).toString('base64')}`;
const PNG = `data:image/png;base64,${Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100, 2)]).toString('base64')}`;

async function req(method: string, url: string, body?: unknown, opts: { cookie?: string; device?: string; fp?: string; ip?: string } = {}) {
  const headers: Record<string, string> = {};
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.device) headers['x-crucible-device'] = opts.device;
  if (opts.fp) headers['x-crucible-fp'] = opts.fp;
  const res = await app.inject({ method: method as any, url, payload: body as any, headers, remoteAddress: opts.ip ?? '10.0.0.1' });
  let parsed: any = null;
  try { parsed = res.body ? JSON.parse(res.body) : null; } catch { parsed = res.body; }
  return { status: res.statusCode, body: parsed, headers: res.headers, raw: res.rawPayload };
}

async function login(email: string, role: 'recruiter' | 'candidate') {
  const r = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email, name: email, password: 'password1', role } });
  return String(r.headers['set-cookie']).split(';')[0];
}

const mcq = (title: string) => ({
  type: 'mcq', title, difficulty: 'easy', tags: [], visibility: 'private', statement: title,
  data: { options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], correct: ['b'] },
});

describe('proctoring', () => {
  const qids: number[] = [];
  let fixed = 0;
  before(async () => {
    await freshEnv();
    app = await buildApp();
    staff = await login('rec@p.dev', 'recruiter');
    otherStaff = await login('rec2@p.dev', 'recruiter');
    for (let i = 0; i < 4; i++) qids.push(await createQuestion(mcq(`Pool Q${i}`), null));
    fixed = await createQuestion(mcq('Fixed Q'), null);
  });
  after(async () => { await app.close(); });

  async function makeAssessment(proctoring: Record<string, unknown>, extra: Record<string, unknown> = {}) {
    const r = await req('POST', '/api/assessments', {
      title: 'Proctored', durationMin: 30,
      settings: { proctoring, pools: { p: { draw: 2 } }, ...extra },
      questions: [{ questionId: fixed, points: 10 }, ...qids.map((q) => ({ questionId: q, points: 20, pool: 'p' }))],
    }, { cookie: staff });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return r.body.id as number;
  }
  async function invite(aid: number, email: string) {
    return (await req('POST', `/api/assessments/${aid}/invites`, { candidates: [{ email }] }, { cookie: staff })).body.invites[0] as { id: number; token: string };
  }

  test('pools: each candidate draws the configured number, deterministically, and is scored on their draw', async () => {
    const aid = await makeAssessment({});
    const seen = new Set<string>();
    for (let i = 0; i < 6; i++) {
      const inv = await invite(aid, `c${i}@p.dev`);
      const pre = await req('GET', `/api/take/${inv.token}`);
      assert.equal(pre.body.assessment.questionCount, 3, 'intro shows the drawn count');
      assert.equal(pre.body.assessment.totalPoints, 50);
      await req('POST', `/api/take/${inv.token}/start`, { name: `C${i}` }, { device: `d${i}` });
      const t = await req('GET', `/api/take/${inv.token}`, undefined, { device: `d${i}` });
      const ids = t.body.questions.map((q: any) => q.id);
      assert.equal(ids.length, 3);
      assert.ok(ids.includes(fixed));
      seen.add(ids.filter((x: number) => x !== fixed).sort().join(','));
      // A question outside the draw is rejected.
      const notDrawn = qids.find((q) => !ids.includes(q))!;
      assert.equal((await req('PUT', `/api/take/${inv.token}/answers/${notDrawn}`, { choice: 'b' }, { device: `d${i}` })).status, 404);
      for (const q of ids) await req('PUT', `/api/take/${inv.token}/answers/${q}`, { choice: 'b' }, { device: `d${i}` });
      await req('POST', `/api/take/${inv.token}/submit`, {}, { device: `d${i}` });
      const a = getDb().get<any>('SELECT score, max_score FROM attempts WHERE id = ?', inv.id);
      assert.equal(a.max_score, 50);
      assert.equal(a.score, 50);
    }
    assert.ok(seen.size > 1, 'different candidates get different questions');
    const rows = qids.map((q, i) => ({ question_id: q, pool: 'p', ord: i }));
    assert.deepEqual(drawQuestions(rows, { p: { draw: 2 } }, 'abc'), drawQuestions(rows, { p: { draw: 2 } }, 'abc'));
  });

  test('pools: validation', async () => {
    const unequal = await req('POST', '/api/assessments', {
      title: 'Bad', durationMin: 30, settings: { pools: { p: { draw: 1 } } },
      questions: [{ questionId: qids[0], points: 10, pool: 'p' }, { questionId: qids[1], points: 20, pool: 'p' }],
    }, { cookie: staff });
    assert.equal(unequal.status, 400);
    assert.match(unequal.body.error, /same points/);
    const tooMany = await req('POST', '/api/assessments', {
      title: 'Bad', durationMin: 30, settings: { pools: { p: { draw: 5 } } },
      questions: [{ questionId: qids[0], points: 10, pool: 'p' }],
    }, { cookie: staff });
    assert.equal(tooMany.status, 400);
  });

  test('media is refused unless the assessment enables it', async () => {
    const aid = await makeAssessment({ webcam: false, identityCheck: false });
    const inv = await invite(aid, 'nocam@p.dev');
    assert.equal((await req('POST', `/api/take/${inv.token}/media`, { kind: 'identity_selfie', image: JPEG })).status, 403);
    await req('POST', `/api/take/${inv.token}/start`, { name: 'N' }, { device: 'x' });
    assert.equal((await req('POST', `/api/take/${inv.token}/media`, { kind: 'snapshot', image: JPEG, faces: 1 }, { device: 'x' })).status, 403);
  });

  test('identity photos are required before starting, and validated', async () => {
    const aid = await makeAssessment({ webcam: true, identityCheck: true });
    const inv = await invite(aid, 'id@p.dev');
    assert.equal((await req('POST', `/api/take/${inv.token}/start`, { name: 'I' }, { device: 'id' })).status, 409);
    // Wrong magic bytes, mismatched type, oversize, unknown kind.
    const fake = `data:image/jpeg;base64,${Buffer.from('<script>alert(1)</script>').toString('base64')}`;
    assert.equal((await req('POST', `/api/take/${inv.token}/media`, { kind: 'identity_selfie', image: fake })).status, 400);
    assert.equal((await req('POST', `/api/take/${inv.token}/media`, { kind: 'identity_selfie', image: PNG.replace('image/png', 'image/jpeg') })).status, 400);
    const big = `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(480 * 1024)]).toString('base64')}`;
    assert.ok([400, 413].includes((await req('POST', `/api/take/${inv.token}/media`, { kind: 'identity_selfie', image: big })).status));
    assert.equal((await req('POST', `/api/take/${inv.token}/media`, { kind: 'avatar', image: JPEG })).status, 400);
    assert.equal((await req('POST', `/api/take/${inv.token}/media`, { kind: 'snapshot', image: JPEG })).status, 409, 'snapshots need a started test');

    assert.equal((await req('POST', `/api/take/${inv.token}/media`, { kind: 'identity_selfie', image: JPEG, faces: 1, reason: 'identity' })).status, 200);
    assert.equal((await req('POST', `/api/take/${inv.token}/media`, { kind: 'identity_document', image: PNG, reason: 'identity' })).status, 200);
    const pre = await req('GET', `/api/take/${inv.token}`);
    assert.deepEqual(pre.body.identity, { selfie: true, document: true });
    assert.equal((await req('POST', `/api/take/${inv.token}/start`, { name: 'I' }, { device: 'id' })).status, 200);

    // Snapshots: stored, rate limited, and face problems become timeline events.
    assert.equal((await req('POST', `/api/take/${inv.token}/media`, { kind: 'snapshot', image: JPEG, faces: 2, reason: 'multiple_faces' }, { device: 'id' })).status, 200);
    assert.equal((await req('POST', `/api/take/${inv.token}/media`, { kind: 'snapshot', image: JPEG, faces: 1 }, { device: 'id' })).status, 429);
    getDb().run("UPDATE media SET t = t - 20000 WHERE attempt_id = ? AND kind = 'snapshot'", inv.id);
    assert.equal((await req('POST', `/api/take/${inv.token}/media`, { kind: 'snapshot', image: JPEG, faces: 0, reason: 'no_face' }, { device: 'id' })).status, 200);
    const evs = getDb().all<any>('SELECT type FROM events WHERE attempt_id = ?', inv.id).map((e) => e.type);
    assert.ok(evs.includes('multiple_faces') && evs.includes('no_face'));

    // Staff can view the images; other recruiters and anonymous users cannot.
    const rep = await req('GET', `/api/attempts/${inv.id}`, undefined, { cookie: staff });
    assert.equal(rep.body.media.length, 4);
    const img = rep.body.media.find((m: any) => m.kind === 'identity_selfie');
    const got = await req('GET', img.url, undefined, { cookie: staff });
    assert.equal(got.status, 200);
    assert.equal(got.headers['content-type'], 'image/jpeg');
    assert.equal(got.raw[0], 0xff);
    assert.equal((await req('GET', img.url, undefined, { cookie: otherStaff })).status, 404);
    assert.equal((await req('GET', img.url)).status, 401);

    const integ = computeIntegrity(inv.id);
    assert.equal(integ.proctoring.multipleFaces, 1);
    assert.ok(integ.flags.some((f) => /More than one person/.test(f)));

    // Deleting proctoring data removes rows and files.
    assert.equal((await req('DELETE', `/api/attempts/${inv.id}/proctoring`, undefined, { cookie: staff })).status, 200);
    assert.equal(getDb().get<any>('SELECT COUNT(*) AS n FROM media WHERE attempt_id = ?', inv.id).n, 0);
    assert.equal(fs.existsSync(path.join(getMediaRoot(), String(inv.id))), false);
  });

  test('device lock refuses a second browser; staff can unlock', async () => {
    const aid = await makeAssessment({ singleDevice: true });
    const inv = await invite(aid, 'lock@p.dev');
    await req('POST', `/api/take/${inv.token}/start`, { name: 'L' }, { device: 'laptop' });
    assert.equal((await req('GET', `/api/take/${inv.token}`, undefined, { device: 'laptop' })).status, 200);
    const other = await req('GET', `/api/take/${inv.token}`, undefined, { device: 'phone' });
    assert.equal(other.status, 423);
    assert.equal((await req('POST', `/api/take/${inv.token}/events`, { events: [{ type: 'tab_hidden' }] }, { device: 'phone' })).status, 423);
    const integ = computeIntegrity(inv.id);
    assert.equal(integ.counts.device_blocked, 1, 'refusals are recorded once per device');
    assert.ok(integ.flags.some((f) => /tried to open this test/.test(f)));
    assert.equal((await req('POST', `/api/attempts/${inv.id}/unlock-device`, undefined, { cookie: staff })).status, 200);
    assert.equal((await req('GET', `/api/take/${inv.token}`, undefined, { device: 'phone' })).status, 200, 'unlocked: next browser binds');
    assert.equal((await req('GET', `/api/take/${inv.token}`, undefined, { device: 'laptop' })).status, 423);
  });

  test('without the lock, a device switch is recorded instead', async () => {
    const aid = await makeAssessment({ singleDevice: false });
    const inv = await invite(aid, 'switch@p.dev');
    await req('POST', `/api/take/${inv.token}/start`, { name: 'S' }, { device: 'one' });
    assert.equal((await req('GET', `/api/take/${inv.token}`, undefined, { device: 'two', ip: '10.9.9.9' })).status, 200);
    await req('GET', `/api/take/${inv.token}`, undefined, { device: 'two' });
    const integ = computeIntegrity(inv.id);
    assert.equal(integ.counts.device_change, 1, 'recorded once per new device');
    assert.ok(integ.flags.some((f) => /other browser/.test(f)));
    assert.ok(integ.access.networks >= 2);
  });

  test('two candidates on the same browser are flagged; same network is informational', async () => {
    const aid = await makeAssessment({});
    const a = await invite(aid, 'proxy1@p.dev');
    const b = await invite(aid, 'proxy2@p.dev');
    const c = await invite(aid, 'office@p.dev');
    await req('POST', `/api/take/${a.token}/start`, { name: 'Proxy One' }, { device: 'shared-browser', fp: 'fpA', ip: '1.1.1.1' });
    await req('POST', `/api/take/${b.token}/start`, { name: 'Proxy Two' }, { device: 'shared-browser', fp: 'fpA', ip: '1.1.1.1' });
    await req('POST', `/api/take/${c.token}/start`, { name: 'Office' }, { device: 'own-browser', fp: 'fpC', ip: '1.1.1.1' });
    const ia = computeIntegrity(a.id);
    const shared = ia.access.sharedWith.find((s) => s.name === 'Proxy Two');
    assert.equal(shared?.kind, 'device');
    assert.ok(ia.flags.some((f) => /Same browser as Proxy Two/.test(f)));
    const ic = computeIntegrity(c.id);
    assert.ok(ic.access.sharedWith.every((s) => s.kind === 'network'));
    assert.ok(ic.score > ia.score, 'shared network costs far less than a shared device');
    // Other recruiters' candidates are never compared.
    const other = await req('POST', '/api/assessments', { title: 'Theirs', durationMin: 10, questions: [{ questionId: fixed, points: 1 }] }, { cookie: otherStaff });
    const [o] = (await req('POST', `/api/assessments/${other.body.id}/invites`, { candidates: [{ email: 'x@p.dev' }] }, { cookie: otherStaff })).body.invites;
    await req('POST', `/api/take/${o.token}/start`, { name: 'Elsewhere' }, { device: 'shared-browser', fp: 'fpA' });
    assert.ok(!computeIntegrity(a.id).access.sharedWith.some((s) => s.name === 'Elsewhere'));
  });

  test('lockdown events are accepted and scored', async () => {
    const aid = await makeAssessment({ blockExternalPaste: true, blockCopy: true });
    const inv = await invite(aid, 'lockdown@p.dev');
    await req('POST', `/api/take/${inv.token}/start`, { name: 'LD' }, { device: 'ld' });
    const r = await req('POST', `/api/take/${inv.token}/events`, { events: [
      { type: 'paste_blocked' }, { type: 'paste_blocked' }, { type: 'copy_blocked' }, { type: 'multi_monitor' }, { type: 'duplicate_tab' }, { type: 'camera_lost' },
    ] }, { device: 'ld' });
    assert.equal(r.status, 200);
    const integ = computeIntegrity(inv.id);
    for (const re of [/paste from outside/, /copy question text/, /second display/, /more than one tab/, /Camera disconnected/]) {
      assert.ok(integ.flags.some((f) => re.test(f)), String(re));
    }
    assert.ok(integ.score < 70);
  });

  test('retention removes proctoring data after the configured period', async () => {
    const aid = await makeAssessment({ webcam: true }, { retentionDays: 7 });
    const inv = await invite(aid, 'old@p.dev');
    await req('POST', `/api/take/${inv.token}/start`, { name: 'Old' }, { device: 'o' });
    await req('POST', `/api/take/${inv.token}/media`, { kind: 'snapshot', image: JPEG, faces: 1 }, { device: 'o' });
    await req('POST', `/api/take/${inv.token}/submit`, {}, { device: 'o' });
    assert.equal(sweepRetention(), 0, 'recent data is kept');
    getDb().run('UPDATE attempts SET submitted_at = ? WHERE id = ?', Date.now() - 8 * 86400_000, inv.id);
    assert.ok(sweepRetention() >= 1);
    assert.equal(getDb().get<any>('SELECT COUNT(*) AS n FROM media WHERE attempt_id = ?', inv.id).n, 0);
    assert.equal(getDb().get<any>('SELECT COUNT(*) AS n FROM access_log WHERE attempt_id = ?', inv.id).n, 0);
  });
});
