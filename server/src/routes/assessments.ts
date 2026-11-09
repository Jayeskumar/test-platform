import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { aiEnabled, reviewAttempt } from '../ai.js';
import { HttpError, requireStaff, type User } from '../auth.js';
import { getDb, now, parseJson } from '../db/index.js';
import { presentSubmission } from '../questions.js';
import { assessmentPlagiarism, computeIntegrity, gradeMcq, recomputeAttempt } from '../scoring.js';
import { assessmentSettings } from './take.js';

const AssessmentBody = z.object({
  title: z.string().trim().min(3).max(120),
  description: z.string().max(10_000).default(''),
  durationMin: z.number().int().min(5).max(600),
  status: z.enum(['draft', 'active', 'closed']).default('active'),
  settings: z.object({
    languages: z.array(z.string()).default([]),
    proctoring: z.object({
      trackTabs: z.boolean().default(true),
      requireFullscreen: z.boolean().default(false),
      detectPaste: z.boolean().default(true),
      recordPlayback: z.boolean().default(true),
    }).default({}),
    showScoreToCandidate: z.boolean().default(false),
    shuffleQuestions: z.boolean().default(false),
  }).default({}),
  questions: z.array(z.object({ questionId: z.number().int(), points: z.number().int().min(1).max(1000) })).min(1).max(30),
});

const InviteBody = z.object({
  candidates: z.array(z.object({ email: z.string().trim().toLowerCase().email(), name: z.string().trim().max(80).default('') })).min(1).max(200),
});

function ownedAssessment(user: User, id: number) {
  const a = getDb().get<any>('SELECT * FROM assessments WHERE id = ?', id);
  if (!a || (user.role !== 'admin' && a.owner_id !== user.id)) throw new HttpError(404, 'Assessment not found.');
  return a;
}

function ownedAttempt(user: User, id: number) {
  const at = getDb().get<any>('SELECT * FROM attempts WHERE id = ?', id);
  if (!at) throw new HttpError(404, 'Attempt not found.');
  ownedAssessment(user, at.assessment_id);
  return at;
}

export function createAssessment(body: unknown, ownerId: number): number {
  const b = AssessmentBody.parse(body);
  const db = getDb();
  return db.tx(() => {
    const id = db.run(
      'INSERT INTO assessments (owner_id, title, description, duration_min, settings, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ownerId, b.title, b.description, b.durationMin, JSON.stringify(b.settings), b.status, now(),
    ).id;
    b.questions.forEach((q, i) => {
      if (!db.get('SELECT 1 FROM questions WHERE id = ?', q.questionId)) throw new HttpError(400, `Question ${q.questionId} does not exist.`);
      db.run('INSERT INTO assessment_questions (assessment_id, question_id, points, ord) VALUES (?, ?, ?, ?)', id, q.questionId, q.points, i);
    });
    return id;
  });
}

export function inviteCandidates(assessmentId: number, candidates: { email: string; name?: string }[]) {
  const db = getDb();
  return candidates.map((c) => {
    const token = crypto.randomBytes(18).toString('base64url');
    const id = db.run(
      'INSERT INTO attempts (assessment_id, token, candidate_email, candidate_name, created_at) VALUES (?, ?, ?, ?, ?)',
      assessmentId, token, c.email, c.name ?? '', now(),
    ).id;
    return { id, email: c.email, name: c.name ?? '', token };
  });
}

function attemptSummary(a: any) {
  const integrity = parseJson<any>(a.integrity, null);
  return {
    id: a.id,
    name: a.candidate_name,
    email: a.candidate_email,
    status: a.status,
    token: a.token,
    startedAt: a.started_at,
    submittedAt: a.submitted_at,
    deadlineAt: a.deadline_at,
    score: a.score,
    maxScore: a.max_score,
    integrity: integrity ? { score: integrity.score, level: integrity.level, flags: integrity.flags?.length ?? 0 } : null,
    durationMs: a.started_at && a.submitted_at ? a.submitted_at - a.started_at : null,
  };
}

export async function assessmentRoutes(app: FastifyInstance) {
  app.get('/api/assessments', async (req) => {
    const user = requireStaff(req);
    const rows = getDb().all<any>(
      `SELECT a.*,
        (SELECT COUNT(*) FROM assessment_questions aq WHERE aq.assessment_id = a.id) AS questions,
        (SELECT COUNT(*) FROM attempts t WHERE t.assessment_id = a.id) AS invited,
        (SELECT COUNT(*) FROM attempts t WHERE t.assessment_id = a.id AND t.status != 'invited') AS started,
        (SELECT COUNT(*) FROM attempts t WHERE t.assessment_id = a.id AND t.status = 'submitted') AS completed,
        (SELECT AVG(t.score * 100.0 / NULLIF(t.max_score, 0)) FROM attempts t WHERE t.assessment_id = a.id AND t.status = 'submitted') AS avg_pct
       FROM assessments a WHERE a.owner_id = ? OR ? = 'admin' ORDER BY a.created_at DESC`,
      user.id, user.role,
    );
    return {
      assessments: rows.map((r) => ({
        id: r.id, title: r.title, status: r.status, durationMin: r.duration_min, createdAt: r.created_at,
        questions: r.questions, invited: r.invited, started: r.started, completed: r.completed,
        avgPct: r.avg_pct == null ? null : Math.round(r.avg_pct),
      })),
    };
  });

  app.post('/api/assessments', async (req) => {
    const user = requireStaff(req);
    return { id: createAssessment(req.body, user.id) };
  });

  app.get('/api/assessments/:id', async (req) => {
    const user = requireStaff(req);
    const a = ownedAssessment(user, Number((req.params as any).id));
    const db = getDb();
    const questions = db.all<any>(
      `SELECT q.id, q.slug, q.title, q.type, q.difficulty, q.tags, aq.points, aq.ord FROM assessment_questions aq
       JOIN questions q ON q.id = aq.question_id WHERE aq.assessment_id = ? ORDER BY aq.ord`,
      a.id,
    ).map((q) => ({ ...q, tags: parseJson(q.tags, []) }));
    const attempts = db.all<any>('SELECT * FROM attempts WHERE assessment_id = ? ORDER BY COALESCE(score, -1) DESC, created_at DESC', a.id);
    // Per-question averages across submitted attempts.
    const perQuestion = questions.map((q) => {
      const r = db.get<any>(
        `SELECT AVG(an.score) AS avg, COUNT(*) AS n FROM answers an JOIN attempts t ON t.id = an.attempt_id
         WHERE t.assessment_id = ? AND t.status = 'submitted' AND an.question_id = ?`,
        a.id, q.id,
      );
      const submitted = attempts.filter((t) => t.status === 'submitted').length || 1;
      return { questionId: q.id, avgPct: r?.n ? Math.round(((r.avg * r.n) / submitted / q.points) * 100) : 0 };
    });
    return {
      assessment: {
        id: a.id, title: a.title, description: a.description, durationMin: a.duration_min, status: a.status,
        settings: assessmentSettings(a.settings), createdAt: a.created_at,
      },
      questions,
      perQuestion,
      attempts: attempts.map(attemptSummary),
    };
  });

  app.put('/api/assessments/:id', async (req) => {
    const user = requireStaff(req);
    const a = ownedAssessment(user, Number((req.params as any).id));
    const b = AssessmentBody.parse(req.body);
    const db = getDb();
    const started = db.get<any>("SELECT COUNT(*) AS n FROM attempts WHERE assessment_id = ? AND status != 'invited'", a.id).n;
    db.tx(() => {
      db.run(
        'UPDATE assessments SET title = ?, description = ?, duration_min = ?, settings = ?, status = ? WHERE id = ?',
        b.title, b.description, b.durationMin, JSON.stringify(b.settings), b.status, a.id,
      );
      const current = db.all<any>('SELECT question_id, points FROM assessment_questions WHERE assessment_id = ? ORDER BY ord', a.id);
      const same = current.length === b.questions.length && current.every((c, i) => c.question_id === b.questions[i].questionId);
      if (!same && started) throw new HttpError(409, 'Questions cannot change once candidates have started. Points and settings can.');
      db.run('DELETE FROM assessment_questions WHERE assessment_id = ?', a.id);
      b.questions.forEach((q, i) =>
        db.run('INSERT INTO assessment_questions (assessment_id, question_id, points, ord) VALUES (?, ?, ?, ?)', a.id, q.questionId, q.points, i),
      );
    });
    for (const t of db.all<any>("SELECT id FROM attempts WHERE assessment_id = ? AND status != 'invited'", a.id)) recomputeAttempt(t.id);
    return { ok: true };
  });

  app.post('/api/assessments/:id/invites', async (req) => {
    const user = requireStaff(req);
    const a = ownedAssessment(user, Number((req.params as any).id));
    const { candidates } = InviteBody.parse(req.body);
    return { invites: inviteCandidates(a.id, candidates) };
  });

  app.delete('/api/attempts/:id', async (req) => {
    const user = requireStaff(req);
    const at = ownedAttempt(user, Number((req.params as any).id));
    if (at.status !== 'invited') throw new HttpError(409, 'Only unused invitations can be revoked.');
    getDb().run('DELETE FROM attempts WHERE id = ?', at.id);
    return { ok: true };
  });

  app.get('/api/assessments/:id/plagiarism', async (req) => {
    const user = requireStaff(req);
    const a = ownedAssessment(user, Number((req.params as any).id));
    return { matches: assessmentPlagiarism(a.id) };
  });

  /** Full candidate report. */
  app.get('/api/attempts/:id', async (req) => {
    const user = requireStaff(req);
    const at = ownedAttempt(user, Number((req.params as any).id));
    const db = getDb();
    const asmt = db.get<any>('SELECT * FROM assessments WHERE id = ?', at.assessment_id);
    const qs = db.all<any>(
      `SELECT q.*, aq.points, aq.ord FROM assessment_questions aq JOIN questions q ON q.id = aq.question_id WHERE aq.assessment_id = ? ORDER BY aq.ord`,
      at.assessment_id,
    );
    const events = db.all<any>('SELECT id, question_id, type, detail, t FROM events WHERE attempt_id = ? ORDER BY t', at.id)
      .map((e) => ({ ...e, detail: parseJson(e.detail, {}) }));
    const questions = qs.map((q) => {
      const ans = db.get<any>('SELECT * FROM answers WHERE attempt_id = ? AND question_id = ?', at.id, q.id);
      const data = parseJson<any>(q.data, {});
      const subs = db.all<any>('SELECT * FROM submissions WHERE attempt_id = ? AND question_id = ? ORDER BY id', at.id, q.id);
      const best = ans?.best_submission_id ? subs.find((s) => s.id === ans.best_submission_id) : subs.filter((s) => s.kind === 'submit').pop();
      const snaps = db.all<any>('SELECT t, language, code FROM snapshots WHERE attempt_id = ? AND question_id = ? ORDER BY t', at.id, q.id);
      const views = events.filter((e) => e.question_id === q.id && e.type === 'question_view').length;
      const base = {
        id: q.id, title: q.title, type: q.type, difficulty: q.difficulty, points: q.points, statement: q.statement,
        score: ans?.score ?? 0, views,
      };
      if (q.type === 'mcq') {
        const choice = parseJson<any>(ans?.choice, null);
        return { ...base, options: data.options, correct: data.correct, choice, isCorrect: gradeMcq(data, choice) };
      }
      return {
        ...base,
        language: ans?.language ?? best?.language ?? null,
        code: ans?.code ?? best?.code ?? null,
        best: best ? presentSubmission(best, { staff: true }) : null,
        submissions: subs.map((s) => ({
          id: s.id, kind: s.kind, verdict: s.verdict, score: s.score, passed: s.passed, total: s.total,
          language: s.language, createdAt: s.created_at, timeMs: s.time_ms,
        })),
        snapshots: snaps,
      };
    });
    const integrity = at.status === 'invited' ? null : computeIntegrity(at.id);
    if (integrity && at.status === 'submitted') db.run('UPDATE attempts SET integrity = ? WHERE id = ?', JSON.stringify(integrity), at.id);
    // Percentile among submitted attempts of the same assessment.
    const peers = db.all<any>("SELECT score FROM attempts WHERE assessment_id = ? AND status = 'submitted'", at.assessment_id).map((p) => p.score ?? 0);
    const percentile = peers.length && at.status === 'submitted'
      ? Math.round((peers.filter((s) => s < (at.score ?? 0)).length + 0.5 * peers.filter((s) => s === (at.score ?? 0)).length) / peers.length * 100)
      : null;
    return {
      attempt: { ...attemptSummary(at), percentile },
      assessment: { id: asmt.id, title: asmt.title, durationMin: asmt.duration_min },
      questions,
      events,
      integrity,
      ai: { enabled: aiEnabled(), review: parseJson(at.review, null) },
    };
  });

  app.post('/api/attempts/:id/ai-review', async (req) => {
    const user = requireStaff(req);
    const at = ownedAttempt(user, Number((req.params as any).id));
    if (!aiEnabled()) throw new HttpError(400, 'AI review is not configured on this server (set ANTHROPIC_API_KEY).');
    if (at.status !== 'submitted') throw new HttpError(409, 'The candidate has not submitted yet.');
    const db = getDb();
    const asmt = db.get<any>('SELECT * FROM assessments WHERE id = ?', at.assessment_id);
    const qs = db.all<any>(
      `SELECT q.*, aq.points FROM assessment_questions aq JOIN questions q ON q.id = aq.question_id WHERE aq.assessment_id = ? ORDER BY aq.ord`,
      at.assessment_id,
    );
    const input = {
      assessmentTitle: asmt.title,
      questions: qs.map((q) => {
        const ans = db.get<any>('SELECT * FROM answers WHERE attempt_id = ? AND question_id = ?', at.id, q.id);
        const best = ans?.best_submission_id ? db.get<any>('SELECT * FROM submissions WHERE id = ?', ans.best_submission_id) : null;
        return {
          id: q.id, title: q.title, type: q.type, statement: q.statement, points: q.points, score: ans?.score ?? 0,
          language: best?.language ?? ans?.language, code: best?.code ?? ans?.code,
          verdict: best?.verdict, passed: best?.passed, total: best?.total, complexity: parseJson(best?.complexity, null),
        };
      }),
    };
    try {
      const review = await reviewAttempt(input);
      db.run('UPDATE attempts SET review = ? WHERE id = ?', JSON.stringify({ ...review, generatedAt: now() }), at.id);
      return { review: { ...review, generatedAt: now() } };
    } catch (e: any) {
      req.log.error(e);
      throw new HttpError(502, `AI review failed: ${e?.message ?? e}`);
    }
  });
}
