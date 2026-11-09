import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { HttpError, isStaff, requireUser, type User, userFromRequest } from '../auth.js';
import { getDb, now, parseJson } from '../db/index.js';
import { presentSubmission, presentTestEvent, publicQuestion } from '../questions.js';
import { gradeMcq } from '../scoring.js';
import { getService, type JudgeEvent, type QuestionRow } from '../service.js';
import { contestForSubmission } from './contests.js';
import { activeAttemptByToken, attemptHasQuestion } from './take.js';

const DIFF_POINTS: Record<string, number> = { easy: 10, medium: 25, hard: 50 };

const SubmitBody = z.object({
  questionId: z.number().int().optional(),
  slug: z.string().optional(),
  language: z.string().max(20),
  code: z.string().max(100_000),
  kind: z.enum(['run', 'submit']),
  customInput: z.string().max(1_000_000).nullish(),
  attemptToken: z.string().optional(),
  contestSlug: z.string().max(80).optional(),
});

/** Who can see a submission, and with what level of detail. */
function canView(sub: any, user: User | null, token?: string) {
  if (isStaff(user)) return { ok: true, staff: true };
  if (user && sub.user_id === user.id) return { ok: true, staff: false };
  if (token && sub.attempt_id) {
    const a = getDb().get<any>('SELECT id FROM attempts WHERE token = ?', token);
    if (a && a.id === sub.attempt_id) return { ok: true, staff: false };
  }
  return { ok: false, staff: false };
}

export async function practiceRoutes(app: FastifyInstance) {
  app.get('/api/problems', async (req) => {
    const user = userFromRequest(req);
    const db = getDb();
    const rows = db.all<any>(
      `SELECT q.id, q.slug, q.type, q.title, q.difficulty, q.tags,
        (SELECT COUNT(*) FROM submissions s WHERE s.question_id = q.id AND s.kind = 'submit' AND s.attempt_id IS NULL AND s.contest_id IS NULL) AS submissions,
        (SELECT COUNT(*) FROM submissions s WHERE s.question_id = q.id AND s.kind = 'submit' AND s.attempt_id IS NULL AND s.contest_id IS NULL AND s.verdict = 'AC') AS accepted
       FROM questions q WHERE q.visibility = 'public' ORDER BY CASE q.difficulty WHEN 'easy' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, q.id`,
    );
    const status = new Map<number, string>();
    if (user) {
      for (const r of db.all<any>(
        `SELECT question_id, MAX(CASE WHEN verdict = 'AC' THEN 2 ELSE 1 END) AS s FROM submissions
         WHERE user_id = ? AND attempt_id IS NULL AND contest_id IS NULL AND kind = 'submit' GROUP BY question_id`,
        user.id,
      )) status.set(r.question_id, r.s === 2 ? 'solved' : 'attempted');
      for (const r of db.all<any>("SELECT DISTINCT question_id FROM submissions WHERE user_id = ? AND attempt_id IS NULL AND contest_id IS NULL AND kind = 'run'", user.id)) {
        if (!status.has(r.question_id)) status.set(r.question_id, 'attempted');
      }
    }
    return {
      problems: rows.map((r) => ({
        ...r,
        tags: parseJson(r.tags, []),
        points: DIFF_POINTS[r.difficulty],
        acceptance: r.submissions ? Math.round((r.accepted / r.submissions) * 100) : null,
        status: status.get(r.id) ?? 'todo',
      })),
    };
  });

  app.get('/api/problems/:slug', async (req) => {
    const { slug } = req.params as { slug: string };
    const q = getDb().get<QuestionRow>("SELECT * FROM questions WHERE slug = ? AND visibility = 'public'", slug);
    if (!q) throw new HttpError(404, 'Problem not found.');
    return { problem: publicQuestion(q) };
  });

  app.post('/api/problems/:slug/answer', async (req) => {
    const { slug } = req.params as { slug: string };
    const { choice } = z.object({ choice: z.union([z.string(), z.array(z.string())]) }).parse(req.body);
    const q = getDb().get<QuestionRow>("SELECT * FROM questions WHERE slug = ? AND visibility = 'public' AND type = 'mcq'", slug);
    if (!q) throw new HttpError(404, 'Question not found.');
    const data = parseJson<any>(q.data, {});
    return { correct: gradeMcq(data, choice), answer: data.correct ?? [], explanation: data.explanation ?? '' };
  });

  app.post('/api/submissions', async (req) => {
    const body = SubmitBody.parse(req.body);
    const db = getDb();
    const user = userFromRequest(req);
    let attemptId: number | null = null;
    if (body.attemptToken) {
      const attempt = activeAttemptByToken(body.attemptToken, req);
      attemptId = attempt.id;
    } else if (!user) {
      throw new HttpError(401, 'Sign in to run code.');
    }
    const q = body.questionId
      ? db.get<QuestionRow>('SELECT * FROM questions WHERE id = ?', body.questionId)
      : db.get<QuestionRow>('SELECT * FROM questions WHERE slug = ?', body.slug ?? '');
    if (!q) throw new HttpError(404, 'Question not found.');
    let contestId: number | null = null;
    if (attemptId) {
      if (!attemptHasQuestion(attemptId, q.id)) throw new HttpError(403, 'This question is not part of your test.');
    } else if (body.contestSlug) {
      contestId = contestForSubmission(body.contestSlug, user, q.id);
    } else if (q.visibility !== 'public' && !isStaff(user)) {
      throw new HttpError(404, 'Question not found.');
    }
    if (q.type === 'mcq') throw new HttpError(400, 'Multiple choice questions are not run by the judge.');
    const language = q.type === 'sql' ? 'sql' : body.language;
    const data = parseJson<any>(q.data, {});
    if (q.type === 'coding' && Array.isArray(data.languages) && data.languages.length && !data.languages.includes(language)) {
      throw new HttpError(400, `This question accepts: ${data.languages.join(', ')}.`);
    }
    if (q.type === 'coding' && !getService().sandbox.language(language)) {
      throw new HttpError(400, `Language "${language}" is not available on this judge.`);
    }
    // Fair use: at most 3 queued/running submissions per person.
    const owner = attemptId ? ['attempt_id', attemptId] as const : ['user_id', user!.id] as const;
    const busy = db.get<any>(`SELECT COUNT(*) AS n FROM submissions WHERE ${owner[0]} = ? AND status != 'done'`, owner[1]).n;
    if (busy >= 3) throw new HttpError(429, 'You already have submissions being judged — give them a moment.');

    const { id } = db.run(
      `INSERT INTO submissions (user_id, attempt_id, contest_id, question_id, language, code, kind, custom_input, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      user?.id ?? null, attemptId, contestId, q.id, language, body.code, body.kind, body.customInput ?? null, now(),
    );
    if (attemptId) {
      db.run(
        `INSERT INTO answers (attempt_id, question_id, language, code, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(attempt_id, question_id) DO UPDATE SET language = excluded.language, code = excluded.code, updated_at = excluded.updated_at`,
        attemptId, q.id, language, body.code, now(),
      );
    }
    void getService().enqueue(id);
    return { id };
  });

  app.get('/api/submissions/:id', async (req) => {
    const id = Number((req.params as any).id);
    const token = (req.query as any)?.token as string | undefined;
    const sub = getDb().get<any>('SELECT * FROM submissions WHERE id = ?', id);
    if (!sub) throw new HttpError(404, 'Submission not found.');
    const v = canView(sub, userFromRequest(req), token);
    if (!v.ok) throw new HttpError(404, 'Submission not found.');
    return { submission: presentSubmission(sub, { staff: v.staff }) };
  });

  /** Server-sent events: live compile/test progress. */
  app.get('/api/submissions/:id/stream', async (req: FastifyRequest, reply: FastifyReply) => {
    const id = Number((req.params as any).id);
    const token = (req.query as any)?.token as string | undefined;
    const sub = getDb().get<any>('SELECT * FROM submissions WHERE id = ?', id);
    if (!sub) throw new HttpError(404, 'Submission not found.');
    const v = canView(sub, userFromRequest(req), token);
    if (!v.ok) throw new HttpError(404, 'Submission not found.');
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const send = (ev: JudgeEvent) => {
      let payload: any = ev;
      if (ev.type === 'test') payload = { ...ev, result: presentTestEvent(ev.result, v.staff) };
      if (ev.type === 'done') payload = { type: 'done', submission: presentSubmission(ev.submission, { staff: v.staff }) };
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };
    const svc = getService();
    const close = () => {
      svc.off(`sub:${id}`, onEvent);
      clearInterval(ping);
      res.end();
    };
    const onEvent = (ev: JudgeEvent) => {
      send(ev);
      if (ev.type === 'done') close();
    };
    const ping = setInterval(() => res.write(': ping\n\n'), 15_000);
    req.raw.on('close', close);
    const current = getDb().get<any>('SELECT * FROM submissions WHERE id = ?', id);
    if (current.status === 'done') {
      send({ type: 'done', submission: current });
      return close();
    }
    for (const ev of svc.eventsFor(id)) send(ev);
    svc.on(`sub:${id}`, onEvent);
  });

  app.get('/api/problems/:slug/submissions', async (req) => {
    const user = requireUser(req);
    const { slug } = req.params as { slug: string };
    const rows = getDb().all<any>(
      `SELECT s.* FROM submissions s JOIN questions q ON q.id = s.question_id
       WHERE q.slug = ? AND s.user_id = ? AND s.attempt_id IS NULL AND s.contest_id IS NULL AND s.kind = 'submit' ORDER BY s.id DESC LIMIT 50`,
      slug, user.id,
    );
    return { submissions: rows.map((r) => presentSubmission(r, { staff: isStaff(user) })) };
  });

  app.get('/api/me/stats', async (req) => {
    const user = requireUser(req);
    const db = getDb();
    const solved = db.all<any>(
      `SELECT DISTINCT q.id, q.slug, q.title, q.difficulty, q.tags, q.type FROM submissions s JOIN questions q ON q.id = s.question_id
       WHERE s.user_id = ? AND s.attempt_id IS NULL AND s.contest_id IS NULL AND s.verdict = 'AC' AND s.kind = 'submit'`,
      user.id,
    );
    const totals = db.all<any>("SELECT difficulty, COUNT(*) AS n FROM questions WHERE visibility = 'public' AND type != 'mcq' GROUP BY difficulty");
    const tagTotals = new Map<string, number>();
    for (const q of db.all<any>("SELECT tags FROM questions WHERE visibility = 'public' AND type != 'mcq'")) {
      for (const t of parseJson<string[]>(q.tags, [])) tagTotals.set(t, (tagTotals.get(t) ?? 0) + 1);
    }
    const tagSolved = new Map<string, number>();
    for (const q of solved) for (const t of parseJson<string[]>(q.tags, [])) tagSolved.set(t, (tagSolved.get(t) ?? 0) + 1);
    const skills = [...tagTotals.entries()]
      .filter(([, n]) => n >= 2)
      .map(([tag, total]) => ({ tag, total, solved: tagSolved.get(tag) ?? 0 }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 8);
    const since = now() - 365 * 86400_000;
    const activity = db.all<any>(
      `SELECT date(created_at / 1000, 'unixepoch') AS day, COUNT(*) AS n FROM submissions
       WHERE user_id = ? AND created_at > ? GROUP BY day ORDER BY day`,
      user.id, since,
    );
    const languages = db.all<any>(
      "SELECT language, COUNT(*) AS n FROM submissions WHERE user_id = ? AND kind = 'submit' GROUP BY language ORDER BY n DESC",
      user.id,
    );
    const recent = db.all<any>(
      `SELECT s.id, s.verdict, s.language, s.created_at, s.time_ms, q.title, q.slug FROM submissions s JOIN questions q ON q.id = s.question_id
       WHERE s.user_id = ? AND s.kind = 'submit' AND s.attempt_id IS NULL AND s.contest_id IS NULL ORDER BY s.id DESC LIMIT 10`,
      user.id,
    );
    const points = solved.reduce((s, q) => s + (DIFF_POINTS[q.difficulty] ?? 0), 0);
    // Streak: consecutive days up to today with at least one submission.
    const days = new Set(activity.map((a) => a.day));
    let streak = 0;
    for (let d = new Date(); ; d.setUTCDate(d.getUTCDate() - 1)) {
      const key = d.toISOString().slice(0, 10);
      if (days.has(key)) streak++;
      else if (streak > 0 || key !== new Date().toISOString().slice(0, 10)) break;
    }
    const rank = db.all<any>(
      `SELECT s.user_id, SUM(CASE q.difficulty WHEN 'easy' THEN 10 WHEN 'medium' THEN 25 ELSE 50 END) AS pts FROM
        (SELECT DISTINCT user_id, question_id FROM submissions WHERE verdict = 'AC' AND kind = 'submit' AND attempt_id IS NULL AND contest_id IS NULL AND user_id IS NOT NULL) s
        JOIN questions q ON q.id = s.question_id GROUP BY s.user_id`,
    );
    const better = rank.filter((r) => r.pts > points).length;
    return {
      points,
      rank: better + 1,
      ranked: Math.max(rank.length, 1),
      streak,
      solved: solved.map((q) => ({ ...q, tags: parseJson(q.tags, []) })),
      totals: Object.fromEntries(totals.map((t) => [t.difficulty, t.n])),
      skills,
      activity,
      languages,
      recent,
    };
  });

  app.get('/api/leaderboard', async () => {
    const rows = getDb().all<any>(
      `SELECT u.id, u.name, COUNT(*) AS solved,
        SUM(CASE q.difficulty WHEN 'easy' THEN 10 WHEN 'medium' THEN 25 ELSE 50 END) AS points,
        MAX(s.first_ac) AS last_solve
       FROM (SELECT user_id, question_id, MIN(created_at) AS first_ac FROM submissions
             WHERE verdict = 'AC' AND kind = 'submit' AND attempt_id IS NULL AND contest_id IS NULL AND user_id IS NOT NULL GROUP BY user_id, question_id) s
       JOIN questions q ON q.id = s.question_id JOIN users u ON u.id = s.user_id
       GROUP BY u.id ORDER BY points DESC, last_solve ASC LIMIT 100`,
    );
    return { leaders: rows };
  });
}
