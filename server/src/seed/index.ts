import { hashPassword } from '../auth.js';
import { config } from '../config.js';
import { getDb, now } from '../db/index.js';
import { createAssessment, inviteCandidates } from '../routes/assessments.js';
import { createContest } from '../routes/contests.js';
import { createQuestion } from '../routes/library.js';
import { finalizeAttempt } from '../routes/take.js';
import { DEMO_CANDIDATES } from './candidates.js';
import { EDITORIALS } from './editorials.js';
import { PROBLEMS } from './problems.js';

export const DEMO_PASSWORD = 'crucible123';
export const DEMO_ACCOUNTS = [
  { email: 'recruiter@crucible.dev', name: 'Riley Recruiter', role: 'recruiter' },
  { email: 'admin@crucible.dev', name: 'Ada Admin', role: 'admin' },
  { email: 'candidate@crucible.dev', name: 'Casey Candidate', role: 'candidate' },
] as const;

const LEADERBOARD_USERS = ['Priya Raman', 'Mateo Silva', 'Hana Kobayashi', 'Oluwaseun Ade', 'Lena Novak', 'Sam Okafor'];

function addUser(email: string, name: string, role: string) {
  return getDb().run(
    'INSERT INTO users (email, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)',
    email, name, hashPassword(DEMO_PASSWORD), role, now() - 40 * 86400_000,
  ).id;
}

/**
 * Seeds an empty database. The question bank is always installed. Demo accounts
 * (with a published password), practice history and the demo assessment are only
 * installed outside production, or when SEED_DEMO=1 — never silently in production.
 */
/** Databases seeded before hints existed: add them to built-in questions that have none yet. */
export function backfillEditorials(log = console.log) {
  const db = getDb();
  let n = 0;
  for (const [slug, ed] of Object.entries(EDITORIALS)) {
    const q = db.get<any>('SELECT id, data FROM questions WHERE slug = ?', slug);
    if (!q) continue;
    const data = JSON.parse(q.data || '{}');
    if ('hints' in data || 'editorial' in data) continue;
    db.run('UPDATE questions SET data = ? WHERE id = ?', JSON.stringify({ ...data, ...ed }), q.id);
    n++;
  }
  if (n) log(`[seed] added hints and editorials to ${n} built-in questions`);
}

export async function seedIfEmpty(log = console.log, opts: { demo?: boolean } = {}) {
  const db = getDb();
  if (db.get<any>('SELECT COUNT(*) AS n FROM questions').n > 0 || db.get<any>('SELECT COUNT(*) AS n FROM users').n > 0) {
    backfillEditorials(log);
    return false;
  }
  const demo = opts.demo ?? (process.env.SEED_DEMO ? process.env.SEED_DEMO === '1' : !config.isProd);
  const t0 = Date.now();
  log(`[seed] empty database — installing the question bank${demo ? ' and demo content' : ''}`);
  const ids: Record<string, number> = {};
  if (demo) for (const a of DEMO_ACCOUNTS) ids[a.email] = addUser(a.email, a.name, a.role);
  if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
    if (process.env.ADMIN_PASSWORD.length < 12) throw new Error('ADMIN_PASSWORD must be at least 12 characters.');
    db.run(
      'INSERT INTO users (email, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(email) DO NOTHING',
      process.env.ADMIN_EMAIL.toLowerCase(), 'Administrator', hashPassword(process.env.ADMIN_PASSWORD), 'admin', now(),
    );
    log(`[seed] admin account ${process.env.ADMIN_EMAIL} created`);
  }
  const recruiter = ids['recruiter@crucible.dev'] ?? null;

  // Questions: expected outputs are produced by running each reference solution in the judge.
  const qid: Record<string, number> = {};
  await Promise.all(
    PROBLEMS.map(async (p) => {
      qid[p.slug] = await createQuestion(
        {
          slug: p.slug, type: p.type, title: p.title, difficulty: p.difficulty, tags: p.tags, statement: p.statement,
          visibility: p.visibility, data: { ...p.data, ...(EDITORIALS[p.slug] ?? {}) },
          tests: p.tests.map((t) => ({ input: t.input, expected: t.expected ?? '', is_sample: !!t.sample, weight: t.weight ?? 1, explanation: t.explanation ?? '' })),
        },
        recruiter,
      );
    }),
  );
  log(`[seed] ${PROBLEMS.length} questions ready (${Date.now() - t0} ms)`);
  if (!demo || recruiter == null) return true;

  // Practice history so the leaderboard and dashboards are not empty.
  const practice = PROBLEMS.filter((p) => p.visibility === 'public' && p.type !== 'mcq');
  const day = 86400_000;
  const insertPractice = (userId: number, slug: string, verdict: string, ago: number) => {
    const p = PROBLEMS.find((x) => x.slug === slug)!;
    const ref = (p.data as any).reference;
    const language = p.type === 'sql' ? 'sql' : ref?.language ?? 'python';
    const code = p.type === 'sql' ? (p.data as any).solution : ref?.code ?? '';
    const created = now() - ago;
    db.run(
      `INSERT INTO submissions (user_id, question_id, language, code, kind, status, verdict, score, passed, total, time_ms, memory_kb, results, created_at, finished_at)
       VALUES (?, ?, ?, ?, 'submit', 'done', ?, ?, ?, ?, ?, ?, '[]', ?, ?)`,
      userId, qid[slug], language, code, verdict, verdict === 'AC' ? 1 : 0.4, verdict === 'AC' ? p.tests.length : 2, p.tests.length,
      80 + (ago % 300), 12000 + (ago % 9000), created, created + 1500,
    );
  };
  const demoUsers: number[] = [];
  LEADERBOARD_USERS.forEach((name, i) => {
    const uid = addUser(`${name.split(' ')[0].toLowerCase()}@demo.crucible.dev`, name, 'candidate');
    demoUsers.push(uid);
    const count = practice.length - i * 2;
    practice.slice(0, count).forEach((p, k) => insertPractice(uid, p.slug, 'AC', (k * 3 + i + 1) * day + k * 3600_000));
  });
  // Contests: one running now (with a live board), one finished, one upcoming.
  const contestProblems = ['balanced-brackets', 'longest-unique-streak', 'warehouse-robot', 'change-making-ways'].map((s) => qid[s]);
  const seedContest = (title: string, startsAt: number, durationMin: number, freezeMin: number, plan: number[][]) => {
    const { id } = createContest({ title, description: 'Four problems, two hours. ICPC rules: problems solved, then penalty time (minutes to accept + 20 per rejected attempt).', startsAt, durationMin, penaltyMin: 20, freezeMin, problems: contestProblems }, recruiter);
    demoUsers.forEach((uid, u) => {
      db.run('INSERT INTO contest_entries (contest_id, user_id, joined_at) VALUES (?, ?, ?)', id, uid, startsAt - 600_000);
      // plan[u][p]: minute of accept (>0), -k for k wrong attempts without accept, 0 for untouched
      (plan[u] ?? []).forEach((v, p) => {
        const q = contestProblems[p];
        const wrong = v < 0 ? -v : Math.max(0, (u + p) % 3 - 1);
        for (let k = 0; k < wrong; k++) {
          db.run("INSERT INTO submissions (user_id, contest_id, question_id, language, code, kind, status, verdict, created_at, finished_at) VALUES (?, ?, ?, 'python', '', 'submit', 'done', ?, ?, ?)",
            uid, id, q, k % 2 ? 'TLE' : 'WA', startsAt + Math.max(1, (v > 0 ? v : 30) - 4 + k) * 60_000, startsAt + 60_000);
        }
        if (v > 0) {
          db.run("INSERT INTO submissions (user_id, contest_id, question_id, language, code, kind, status, verdict, created_at, finished_at) VALUES (?, ?, ?, 'python', '', 'submit', 'done', 'AC', ?, ?)",
            uid, id, q, startsAt + v * 60_000 + 5000, startsAt + v * 60_000 + 6000);
        }
      });
    });
  };
  const nowMs = now();
  seedContest('Weekly Sprint #42', nowMs - 38 * 60_000, 120, 30, [[6, 17, 31, 0], [9, 0, 24, -2], [4, 21, 0, 0], [12, 33, -1, 0], [8, -3, 0, 0], [0, 0, 0, 0]]);
  seedContest('Opening Round', nowMs - 2 * day - 3 * 3600_000, 120, 0, [[7, 19, 44, 88], [5, 26, 61, 0], [11, 31, 52, 97], [9, 0, 73, -2], [15, 40, -3, 0], [22, -1, 0, 0]]);
  seedContest('Weekly Sprint #43', nowMs + 3 * day + 2 * 3600_000, 120, 30, []);

  const casey = ids['candidate@crucible.dev'];
  const caseyHistory: [string, string, number][] = [
    ['pair-sum-count', 'WA', 20], ['pair-sum-count', 'AC', 20], ['balanced-brackets', 'AC', 18], ['count-islands', 'AC', 12],
    ['land-plot-area', 'AC', 9], ['longest-unique-streak', 'TLE', 6], ['longest-unique-streak', 'AC', 5], ['customers-without-orders', 'AC', 3],
    ['merge-meeting-blocks', 'WA', 1],
  ];
  caseyHistory.forEach(([slug, v, d], k) => insertPractice(casey, slug, v, d * day + k * 1000));

  // Demo hiring assessment with simulated candidates who go through the real judge.
  const asmtId = createAssessment(
    {
      title: 'Backend Engineer — Screening',
      description:
        'A 75-minute screen for backend engineers: two coding problems, one SQL query and three short concept questions. ' +
        'You can run your code against the sample tests as often as you like; your best submission per question counts.',
      durationMin: 75,
      status: 'active',
      settings: { proctoring: { trackTabs: true, requireFullscreen: true, detectPaste: true, recordPlayback: true } },
      questions: [
        { questionId: qid['pair-sum-count'], points: 100 },
        { questionId: qid['sliding-window-rate-limiter'], points: 150 },
        { questionId: qid['top-earners-by-department'], points: 100 },
        { questionId: qid['where-vs-having'], points: 20 },
        { questionId: qid['mutable-default-argument'], points: 20 },
        { questionId: qid['idempotent-http-methods'], points: 20 },
      ],
    },
    recruiter,
  );
  const invites = inviteCandidates(asmtId, [
    ...DEMO_CANDIDATES.map((c) => ({ email: c.email, name: c.name })),
    { email: 'alan.t@example.com', name: 'Alan Turing' },
    { email: 'casey@crucible.dev', name: '' },
  ]);
  const base = now() - 2 * day;
  await Promise.all(
    DEMO_CANDIDATES.map(async (c, i) => {
      const inv = invites[i];
      const start = base + i * 3 * 3600_000;
      db.run("UPDATE attempts SET status = 'in_progress', started_at = ?, deadline_at = ? WHERE id = ?", start, start + 75 * 60_000, inv.id);
      for (const [slug, ans] of Object.entries(c.answers)) {
        const q = qid[slug];
        if ('choice' in ans) {
          db.run('INSERT INTO answers (attempt_id, question_id, choice, updated_at) VALUES (?, ?, ?, ?)', inv.id, q, JSON.stringify(ans.choice), start + 60_000);
          continue;
        }
        db.run('INSERT INTO answers (attempt_id, question_id, language, code, updated_at) VALUES (?, ?, ?, ?, ?)', inv.id, q, ans.language, ans.code, start + ans.finishMin * 60_000);
        // Playback: either steady typing or a single paste.
        const linesOfCode = ans.code.split('\n');
        const steps = ans.pasted ? [0, linesOfCode.length] : Array.from({ length: 12 }, (_, k) => Math.round(((k + 1) / 12) * linesOfCode.length));
        const t0 = start + ans.startMin * 60_000;
        const span = (ans.finishMin - ans.startMin) * 60_000;
        steps.forEach((n, k) => {
          const t = ans.pasted ? t0 + k * 1500 : t0 + Math.round(((k + 1) / steps.length) * span);
          db.run('INSERT INTO snapshots (attempt_id, question_id, t, language, code) VALUES (?, ?, ?, ?, ?)', inv.id, q, t, ans.language, linesOfCode.slice(0, n).join('\n'));
        });
        db.run('INSERT INTO events (attempt_id, question_id, type, detail, t) VALUES (?, ?, ?, ?, ?)', inv.id, q, 'question_view', '{}', t0 - 30_000);
      }
      for (const e of c.events) {
        db.run('INSERT INTO events (attempt_id, question_id, type, detail, t) VALUES (?, ?, ?, ?, ?)', inv.id, e.slug ? qid[e.slug] : null, e.type, JSON.stringify(e.detail ?? {}), start + e.min * 60_000);
      }
      await finalizeAttempt(inv.id, 'candidate');
      db.run('UPDATE attempts SET submitted_at = ? WHERE id = ?', start + c.submitMin * 60_000, inv.id);
    }),
  );
  // A second demo: webcam + identity proctoring, lockdown and question pools.
  const proctoredId = createAssessment(
    {
      title: 'Proctored Screening — Webcam & Question Pools',
      description:
        'Demonstrates proctoring: your webcam takes a snapshot about every 30 seconds (faces are detected on your device), ' +
        'you take a selfie and a photo of your ID before starting, and pasting from outside the test is blocked. ' +
        'Each candidate draws different questions from pools of equal difficulty.',
      durationMin: 45,
      status: 'active',
      settings: {
        proctoring: {
          trackTabs: true, detectPaste: true, recordPlayback: true, requireFullscreen: false,
          webcam: true, webcamIntervalSec: 30, identityCheck: true, blockExternalPaste: true, blockCopy: true,
          detectMultiMonitor: true, singleDevice: true,
        },
        pools: { algorithms: { draw: 1 }, concepts: { draw: 2 } },
        retentionDays: 30,
      },
      questions: [
        { questionId: qid['balanced-brackets'], points: 100, pool: 'algorithms' },
        { questionId: qid['count-islands'], points: 100, pool: 'algorithms' },
        { questionId: qid['customers-without-orders'], points: 80 },
        { questionId: qid['closure-in-loop'], points: 20, pool: 'concepts' },
        { questionId: qid['mutable-default-argument'], points: 20, pool: 'concepts' },
        { questionId: qid['stable-sort'], points: 20, pool: 'concepts' },
        { questionId: qid['binary-search-complexity'], points: 20, pool: 'concepts' },
      ],
    },
    recruiter,
  );
  const [demoInvite] = inviteCandidates(proctoredId, [{ email: 'try-me@example.com', name: '' }]);
  log(`[seed] demo assessment judged (${Date.now() - t0} ms total)`);
  log(`[seed] proctored demo test: /t/${demoInvite.token}`);
  log('[seed] demo accounts (password: crucible123):');
  for (const a of DEMO_ACCOUNTS) log(`[seed]   ${a.role.padEnd(10)} ${a.email}`);
  return true;
}
