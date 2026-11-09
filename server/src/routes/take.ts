import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { HttpError } from '../auth.js';
import { getDb, now, parseJson } from '../db/index.js';
import { publicQuestion } from '../questions.js';
import { computeIntegrity, recomputeAttempt } from '../scoring.js';
import { getService, type QuestionRow } from '../service.js';

export const DEFAULT_SETTINGS = {
  languages: [] as string[],
  proctoring: { trackTabs: true, requireFullscreen: false, detectPaste: true, recordPlayback: true },
  showScoreToCandidate: false,
  shuffleQuestions: false,
};

export function assessmentSettings(raw: unknown) {
  const s = parseJson<any>(raw, {});
  return { ...DEFAULT_SETTINGS, ...s, proctoring: { ...DEFAULT_SETTINGS.proctoring, ...(s.proctoring ?? {}) } };
}

function attemptByToken(token: string) {
  const a = getDb().get<any>('SELECT * FROM attempts WHERE token = ?', token);
  if (!a) throw new HttpError(404, 'This test link is not valid.');
  return a;
}

/** Returns the attempt if the candidate may still act on it; finalizes it if time ran out. */
export function activeAttemptByToken(token: string) {
  const a = attemptByToken(token);
  if (a.status === 'invited') throw new HttpError(409, 'Start the test first.');
  if (a.status === 'submitted') throw new HttpError(410, 'This test has already been submitted.');
  if (a.deadline_at && now() > a.deadline_at + 5000) {
    void finalizeAttempt(a.id, 'timeout');
    throw new HttpError(410, 'Time is up — your answers have been submitted.');
  }
  return a;
}

export function attemptHasQuestion(attemptId: number, questionId: number) {
  return !!getDb().get(
    'SELECT 1 FROM attempts a JOIN assessment_questions aq ON aq.assessment_id = a.assessment_id WHERE a.id = ? AND aq.question_id = ?',
    attemptId, questionId,
  );
}

/**
 * Submit an attempt: judge any code that was written but never formally submitted,
 * then compute the final score and integrity report.
 */
export async function finalizeAttempt(attemptId: number, reason: 'candidate' | 'timeout' = 'candidate') {
  const db = getDb();
  const attempt = db.get<any>('SELECT * FROM attempts WHERE id = ?', attemptId);
  if (!attempt || attempt.status !== 'in_progress') return;
  const upd = db.run("UPDATE attempts SET status = 'submitted', submitted_at = ? WHERE id = ? AND status = 'in_progress'", Math.min(now(), attempt.deadline_at ?? now()), attemptId);
  if (!upd.changes) return; // someone else finalized concurrently
  db.run('INSERT INTO events (attempt_id, type, detail, t) VALUES (?, ?, ?, ?)', attemptId, 'submitted', JSON.stringify({ reason }), now());
  const pending: Promise<void>[] = [];
  const answers = db.all<any>(
    `SELECT an.*, q.type FROM answers an JOIN questions q ON q.id = an.question_id WHERE an.attempt_id = ? AND q.type IN ('coding','sql') AND an.code IS NOT NULL`,
    attemptId,
  );
  for (const an of answers) {
    const last = db.get<any>(
      "SELECT code, language FROM submissions WHERE attempt_id = ? AND question_id = ? AND kind = 'submit' ORDER BY id DESC LIMIT 1",
      attemptId, an.question_id,
    );
    if (last && last.code === an.code && last.language === an.language) continue;
    if (!an.code.trim()) continue;
    const { id } = db.run(
      `INSERT INTO submissions (user_id, attempt_id, question_id, language, code, kind, created_at) VALUES (?, ?, ?, ?, ?, 'submit', ?)`,
      attempt.user_id, attemptId, an.question_id, an.type === 'sql' ? 'sql' : an.language ?? 'python', an.code, now(),
    );
    pending.push(getService().enqueue(id));
  }
  // Wait for anything still being judged for this attempt.
  for (const s of db.all<any>("SELECT id FROM submissions WHERE attempt_id = ? AND status != 'done'", attemptId)) {
    pending.push(getService().waitFor(s.id));
  }
  await Promise.all(pending);
  recomputeAttempt(attemptId);
  db.run('UPDATE attempts SET integrity = ? WHERE id = ?', JSON.stringify(computeIntegrity(attemptId)), attemptId);
}

/** Finalize attempts whose deadline has passed (runs periodically). */
export function sweepExpired() {
  const rows = getDb().all<any>("SELECT id FROM attempts WHERE status = 'in_progress' AND deadline_at < ?", now() - 5000);
  for (const r of rows) void finalizeAttempt(r.id, 'timeout');
}

const AnswerBody = z.object({
  language: z.string().max(20).optional(),
  code: z.string().max(100_000).optional(),
  choice: z.union([z.string(), z.array(z.string())]).optional(),
});

const EventsBody = z.object({
  events: z.array(z.object({
    type: z.enum(['tab_hidden', 'tab_visible', 'blur', 'focus', 'paste', 'copy', 'fullscreen_exit', 'fullscreen_enter', 'question_view', 'run']),
    questionId: z.number().int().nullish(),
    detail: z.record(z.any()).optional(),
    t: z.number().optional(),
  })).max(200),
});

export async function takeRoutes(app: FastifyInstance) {
  app.get('/api/take/:token', async (req) => {
    const { token } = req.params as { token: string };
    const db = getDb();
    let a = attemptByToken(token);
    if (a.status === 'in_progress' && a.deadline_at && now() > a.deadline_at + 5000) {
      await finalizeAttempt(a.id, 'timeout');
      a = attemptByToken(token);
    }
    const asmt = db.get<any>('SELECT * FROM assessments WHERE id = ?', a.assessment_id);
    const settings = assessmentSettings(asmt.settings);
    const qrows = db.all<any>(
      `SELECT q.*, aq.points, aq.ord FROM assessment_questions aq JOIN questions q ON q.id = aq.question_id WHERE aq.assessment_id = ? ORDER BY aq.ord`,
      a.assessment_id,
    );
    const base = {
      attempt: {
        status: a.status,
        candidateName: a.candidate_name,
        candidateEmail: a.candidate_email,
        startedAt: a.started_at,
        deadlineAt: a.deadline_at,
        submittedAt: a.submitted_at,
        serverNow: now(),
        score: settings.showScoreToCandidate && a.status === 'submitted' ? a.score : undefined,
        maxScore: settings.showScoreToCandidate && a.status === 'submitted' ? a.max_score : undefined,
      },
      assessment: {
        title: asmt.title,
        description: asmt.description,
        durationMin: asmt.duration_min,
        status: asmt.status,
        questionCount: qrows.length,
        totalPoints: qrows.reduce((s, q) => s + q.points, 0),
        breakdown: {
          coding: qrows.filter((q) => q.type === 'coding').length,
          sql: qrows.filter((q) => q.type === 'sql').length,
          mcq: qrows.filter((q) => q.type === 'mcq').length,
        },
        settings: { languages: settings.languages, proctoring: settings.proctoring },
      },
    };
    if (a.status !== 'in_progress') return base;
    const answers = new Map(db.all<any>('SELECT * FROM answers WHERE attempt_id = ?', a.id).map((r) => [r.question_id, r]));
    let questions = qrows.map((q: QuestionRow & { points: number }) => {
      const ans = answers.get(q.id);
      return {
        ...publicQuestion(q),
        points: q.points,
        answer: ans ? { language: ans.language, code: ans.code, choice: parseJson(ans.choice, null) } : null,
      };
    });
    if (settings.shuffleQuestions) {
      // Deterministic per-candidate order.
      const seed = [...token].reduce((s, c) => (s * 31 + c.charCodeAt(0)) >>> 0, 7);
      questions = questions
        .map((q, i) => ({ q, k: ((seed ^ (i * 2654435761)) >>> 0) % 1000 }))
        .sort((x, y) => x.k - y.k)
        .map((x) => x.q);
    }
    return { ...base, questions };
  });

  app.post('/api/take/:token/start', async (req) => {
    const { token } = req.params as { token: string };
    const { name } = z.object({ name: z.string().trim().min(1).max(80) }).parse(req.body);
    const db = getDb();
    const a = attemptByToken(token);
    const asmt = db.get<any>('SELECT * FROM assessments WHERE id = ?', a.assessment_id);
    if (asmt.status !== 'active') throw new HttpError(403, 'This assessment is not accepting candidates right now.');
    if (a.status === 'invited') {
      const t = now();
      db.run(
        "UPDATE attempts SET status = 'in_progress', candidate_name = ?, started_at = ?, deadline_at = ? WHERE id = ? AND status = 'invited'",
        name, t, t + asmt.duration_min * 60_000, a.id,
      );
    }
    return { ok: true };
  });

  app.put('/api/take/:token/answers/:questionId', async (req) => {
    const { token, questionId } = req.params as { token: string; questionId: string };
    const qid = Number(questionId);
    const body = AnswerBody.parse(req.body);
    const a = activeAttemptByToken(token);
    if (!attemptHasQuestion(a.id, qid)) throw new HttpError(404, 'Question not found.');
    const db = getDb();
    const t = now();
    if (body.choice !== undefined) {
      db.run(
        `INSERT INTO answers (attempt_id, question_id, choice, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(attempt_id, question_id) DO UPDATE SET choice = excluded.choice, updated_at = excluded.updated_at`,
        a.id, qid, JSON.stringify(body.choice), t,
      );
      recomputeAttempt(a.id);
    }
    if (body.code !== undefined) {
      db.run(
        `INSERT INTO answers (attempt_id, question_id, language, code, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(attempt_id, question_id) DO UPDATE SET language = excluded.language, code = excluded.code, updated_at = excluded.updated_at`,
        a.id, qid, body.language ?? null, body.code, t,
      );
      const last = db.get<any>('SELECT code, language FROM snapshots WHERE attempt_id = ? AND question_id = ? ORDER BY t DESC LIMIT 1', a.id, qid);
      if (!last || last.code !== body.code || last.language !== (body.language ?? null)) {
        db.run('INSERT INTO snapshots (attempt_id, question_id, t, language, code) VALUES (?, ?, ?, ?, ?)', a.id, qid, t, body.language ?? null, body.code);
      }
    }
    return { ok: true, savedAt: t };
  });

  app.post('/api/take/:token/events', async (req) => {
    const { token } = req.params as { token: string };
    const { events } = EventsBody.parse(req.body);
    const a = activeAttemptByToken(token);
    const db = getDb();
    db.tx(() => {
      for (const e of events) {
        db.run(
          'INSERT INTO events (attempt_id, question_id, type, detail, t) VALUES (?, ?, ?, ?, ?)',
          a.id, e.questionId ?? null, e.type, JSON.stringify(e.detail ?? {}), Math.min(now(), e.t ?? now()),
        );
      }
    });
    return { ok: true };
  });

  app.post('/api/take/:token/submit', async (req) => {
    const { token } = req.params as { token: string };
    const a = attemptByToken(token);
    if (a.status === 'in_progress') await finalizeAttempt(a.id, 'candidate');
    return { ok: true };
  });
}
