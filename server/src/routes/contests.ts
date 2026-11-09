import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { HttpError, isStaff, requireStaff, requireUser, type User, userFromRequest } from '../auth.js';
import { computeStandings, type ContestRow, contestStatus, isFrozen } from '../contests.js';
import { getDb, now } from '../db/index.js';
import { presentSubmission, publicQuestion } from '../questions.js';
import { getService, type QuestionRow } from '../service.js';

export function contestBySlug(slug: string) {
  const c = getDb().get<ContestRow>('SELECT * FROM contests WHERE slug = ?', slug);
  if (!c) throw new HttpError(404, 'Contest not found.');
  return c;
}

const canManage = (c: ContestRow, user: User | null) => !!user && (user.role === 'admin' || (isStaff(user) && c.owner_id === user.id));

function summary(c: ContestRow, userId: number | null) {
  const db = getDb();
  return {
    id: c.id, slug: c.slug, title: c.title, description: c.description,
    startsAt: c.starts_at, endsAt: c.ends_at, penaltyMin: c.penalty_min, freezeMin: c.freeze_min,
    status: contestStatus(c), frozen: isFrozen(c),
    problems: db.get<any>('SELECT COUNT(*) AS n FROM contest_problems WHERE contest_id = ?', c.id).n,
    participants: db.get<any>('SELECT COUNT(*) AS n FROM contest_entries WHERE contest_id = ?', c.id).n,
    joined: userId ? !!db.get('SELECT 1 FROM contest_entries WHERE contest_id = ? AND user_id = ?', c.id, userId) : false,
  };
}

export function joinContest(c: ContestRow, userId: number) {
  if (contestStatus(c) === 'ended') throw new HttpError(409, 'This contest has ended.');
  getDb().run('INSERT OR IGNORE INTO contest_entries (contest_id, user_id, joined_at) VALUES (?, ?, ?)', c.id, userId, now());
}

/** Validates a contest submission and returns the contest id (auto-joins the user). */
export function contestForSubmission(slug: string, user: User | null, questionId: number) {
  if (!user) throw new HttpError(401, 'Sign in to take part.');
  const c = contestBySlug(slug);
  if (contestStatus(c) !== 'running') throw new HttpError(409, contestStatus(c) === 'upcoming' ? 'The contest has not started yet.' : 'The contest has ended.');
  if (!getDb().get('SELECT 1 FROM contest_problems WHERE contest_id = ? AND question_id = ?', c.id, questionId)) {
    throw new HttpError(404, 'That problem is not part of this contest.');
  }
  joinContest(c, user.id);
  return c.id;
}

const CreateBody = z.object({
  title: z.string().trim().min(3).max(120),
  description: z.string().max(10_000).default(''),
  startsAt: z.number().int(),
  durationMin: z.number().int().min(10).max(7 * 24 * 60),
  penaltyMin: z.number().int().min(0).max(120).default(20),
  freezeMin: z.number().int().min(0).max(240).default(0),
  problems: z.array(z.number().int()).min(1).max(26),
});

export function createContest(body: unknown, ownerId: number | null) {
  const b = CreateBody.parse(body);
  if (b.freezeMin >= b.durationMin) throw new HttpError(400, 'The freeze must be shorter than the contest.');
  const db = getDb();
  return db.tx(() => {
    let slug = b.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'contest';
    for (let n = 2; db.get('SELECT 1 FROM contests WHERE slug = ?', slug); n++) slug = `${slug.replace(/-\d+$/, '')}-${n}`;
    const id = db.run(
      'INSERT INTO contests (slug, title, description, starts_at, ends_at, penalty_min, freeze_min, owner_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      slug, b.title, b.description, b.startsAt, b.startsAt + b.durationMin * 60_000, b.penaltyMin, b.freezeMin, ownerId, now(),
    ).id;
    b.problems.forEach((qid, i) => {
      const q = db.get<any>('SELECT type FROM questions WHERE id = ?', qid);
      if (!q) throw new HttpError(400, `Question ${qid} does not exist.`);
      if (q.type === 'mcq') throw new HttpError(400, 'Contests use coding and SQL questions only.');
      db.run('INSERT INTO contest_problems (contest_id, question_id, label, ord) VALUES (?, ?, ?, ?)', id, qid, String.fromCharCode(65 + i), i);
    });
    return { id, slug };
  });
}

export async function contestRoutes(app: FastifyInstance) {
  app.get('/api/contests', async (req) => {
    const user = userFromRequest(req);
    const rows = getDb().all<ContestRow>('SELECT * FROM contests ORDER BY starts_at DESC');
    return { contests: rows.map((c) => summary(c, user?.id ?? null)), serverNow: now() };
  });

  app.get('/api/contests/:slug', async (req) => {
    const user = userFromRequest(req);
    const c = contestBySlug((req.params as any).slug);
    const status = contestStatus(c);
    const db = getDb();
    const visible = status !== 'upcoming' || canManage(c, user);
    const problems = visible
      ? db.all<any>(
        `SELECT cp.label, q.id, q.slug, q.title, q.difficulty, q.type FROM contest_problems cp JOIN questions q ON q.id = cp.question_id
         WHERE cp.contest_id = ? ORDER BY cp.ord`,
        c.id,
      )
      : [];
    const mine = user
      ? db.all<any>(
        "SELECT question_id, MAX(CASE WHEN verdict = 'AC' THEN 2 ELSE 1 END) AS s FROM submissions WHERE contest_id = ? AND user_id = ? AND kind = 'submit' GROUP BY question_id",
        c.id, user.id,
      )
      : [];
    const myStatus = new Map(mine.map((m) => [m.question_id, m.s === 2 ? 'solved' : 'attempted']));
    return {
      contest: { ...summary(c, user?.id ?? null), canManage: canManage(c, user) },
      problems: problems.map((p) => ({ ...p, mine: myStatus.get(p.id) ?? null })),
      serverNow: now(),
    };
  });

  app.post('/api/contests/:slug/join', async (req) => {
    const user = requireUser(req);
    const c = contestBySlug((req.params as any).slug);
    joinContest(c, user.id);
    return { ok: true };
  });

  app.get('/api/contests/:slug/problems/:label', async (req) => {
    const user = userFromRequest(req);
    const { slug, label } = req.params as { slug: string; label: string };
    const c = contestBySlug(slug);
    if (contestStatus(c) === 'upcoming' && !canManage(c, user)) throw new HttpError(403, 'Problems are revealed when the contest starts.');
    const q = getDb().get<QuestionRow>(
      'SELECT q.* FROM contest_problems cp JOIN questions q ON q.id = cp.question_id WHERE cp.contest_id = ? AND cp.label = ?',
      c.id, label.toUpperCase(),
    );
    if (!q) throw new HttpError(404, 'Problem not found.');
    // Contests judge correctness and speed; the complexity target is shown in practice only.
    const pq: any = publicQuestion(q);
    return { problem: { ...pq, complexity: null }, label: label.toUpperCase() };
  });

  app.get('/api/contests/:slug/submissions', async (req) => {
    const user = requireUser(req);
    const c = contestBySlug((req.params as any).slug);
    const rows = getDb().all<any>(
      "SELECT * FROM submissions WHERE contest_id = ? AND user_id = ? AND kind = 'submit' ORDER BY id DESC LIMIT 100",
      c.id, user.id,
    );
    return { submissions: rows.map((r) => presentSubmission(r, { staff: false })) };
  });

  app.get('/api/contests/:slug/standings', async (req) => {
    const user = userFromRequest(req);
    const c = contestBySlug((req.params as any).slug);
    return { ...computeStandings(c, { frozenView: !canManage(c, user) }), status: contestStatus(c), serverNow: now() };
  });

  /** Server-sent events: fresh standings whenever a contest submission is judged. */
  app.get('/api/contests/:slug/standings/stream', async (req, reply) => {
    const user = userFromRequest(req);
    const c = contestBySlug((req.params as any).slug);
    const frozenView = !canManage(c, user);
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    const send = () => res.write(`data: ${JSON.stringify({ ...computeStandings(c, { frozenView }), status: contestStatus(c), serverNow: now() })}\n\n`);
    let timer: ReturnType<typeof setTimeout> | null = null;
    // Coalesce bursts of verdicts into one recomputation.
    const onChange = () => { if (!timer) timer = setTimeout(() => { timer = null; send(); }, 400); };
    const svc = getService();
    svc.on(`contest:${c.id}`, onChange);
    const ping = setInterval(() => res.write(': ping\n\n'), 15_000);
    req.raw.on('close', () => { svc.off(`contest:${c.id}`, onChange); clearInterval(ping); if (timer) clearTimeout(timer); });
    send();
  });

  app.post('/api/contests', async (req) => {
    const user = requireStaff(req);
    return createContest(req.body, user.id);
  });

  app.delete('/api/contests/:slug', async (req) => {
    const user = requireStaff(req);
    const c = contestBySlug((req.params as any).slug);
    if (!canManage(c, user)) throw new HttpError(404, 'Contest not found.');
    getDb().run('DELETE FROM contests WHERE id = ?', c.id);
    return { ok: true };
  });
}
