import crypto from 'node:crypto';
import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { aiEnabled, reviewAttempt } from '../ai.js';
import { HttpError, requireStaff, type User } from '../auth.js';
import { getDb, now, parseJson } from '../db/index.js';
import { deleteProctoringData, mediaPath } from '../media.js';
import { attemptQuestionIds } from '../proctor.js';
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
      webcam: z.boolean().default(false),
      webcamIntervalSec: z.number().int().min(15).max(300).default(45),
      identityCheck: z.boolean().default(false),
      blockExternalPaste: z.boolean().default(false),
      blockCopy: z.boolean().default(false),
      detectMultiMonitor: z.boolean().default(true),
      singleDevice: z.boolean().default(false),
    }).prefault({}),
    showScoreToCandidate: z.boolean().default(false),
    shuffleQuestions: z.boolean().default(false),
    pools: z.record(z.string().trim().min(1).max(30), z.object({ draw: z.number().int().min(1).max(30) })).default({}),
    retentionDays: z.number().int().min(1).max(730).default(90),
  }).prefault({}),
  questions: z.array(z.object({
    questionId: z.number().int(),
    points: z.number().int().min(1).max(1000),
    pool: z.string().trim().max(30).nullish().transform((v) => v || null),
  })).min(1).max(60),
}).superRefine((b, ctx) => {
  const pools = new Map<string, number[]>();
  for (const q of b.questions) if (q.pool) pools.set(q.pool, [...(pools.get(q.pool) ?? []), q.points]);
  for (const [name, pts] of pools) {
    if (new Set(pts).size > 1) ctx.addIssue({ code: 'custom', path: ['questions'], message: `every question in pool "${name}" must be worth the same points` });
    const draw = b.settings.pools[name]?.draw ?? pts.length;
    if (draw > pts.length) ctx.addIssue({ code: 'custom', path: ['settings', 'pools'], message: `pool "${name}" draws ${draw} but only has ${pts.length} questions` });
  }
  // Keep only pools that are in use, defaulting to drawing one question.
  b.settings.pools = Object.fromEntries([...pools.keys()].map((k) => [k, { draw: b.settings.pools[k]?.draw ?? 1 }]));
});

const InviteBody = z.object({
  candidates: z.array(z.object({ email: z.string().trim().toLowerCase().email(), name: z.string().trim().max(80).default('') })).min(1).max(200),
});

export type Access = 'view' | 'edit' | 'own';

/** The user's role on an assessment: owner (or admin), editor, reviewer — or null. */
export function assessmentRole(user: User, a: { id: number; owner_id: number }): 'owner' | 'editor' | 'reviewer' | null {
  if (user.role === 'admin' || a.owner_id === user.id) return 'owner';
  const m = getDb().get<any>('SELECT role FROM assessment_members WHERE assessment_id = ? AND user_id = ?', a.id, user.id);
  return m?.role ?? null;
}

const ALLOWED: Record<Access, string[]> = { view: ['owner', 'editor', 'reviewer'], edit: ['owner', 'editor'], own: ['owner'] };

function ownedAssessment(user: User, id: number, need: Access = 'view') {
  const a = getDb().get<any>('SELECT * FROM assessments WHERE id = ?', id);
  const role = a ? assessmentRole(user, a) : null;
  if (!a || !role) throw new HttpError(404, 'Assessment not found.');
  if (!ALLOWED[need].includes(role)) throw new HttpError(403, need === 'own' ? 'Only the owner can manage the team.' : 'Reviewers can view and decide, but not change this assessment.');
  return a;
}

function ownedAttempt(user: User, id: number, need: Access = 'view') {
  const at = getDb().get<any>('SELECT * FROM attempts WHERE id = ?', id);
  if (!at) throw new HttpError(404, 'Attempt not found.');
  ownedAssessment(user, at.assessment_id, need);
  return at;
}

/** Stable id for an integrity flag (flags are generated text). */
export const flagKey = (text: string) => crypto.createHash('sha1').update(text).digest('hex').slice(0, 16);

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
      db.run('INSERT INTO assessment_questions (assessment_id, question_id, points, ord, pool) VALUES (?, ?, ?, ?, ?)', id, q.questionId, q.points, i, q.pool ?? null);
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
    decision: a.decision ?? null,
    notes: a.notes ?? '',
    decidedAt: a.decided_at ?? null,
    decidedBy: a.decided_by ?? null,
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
       FROM assessments a WHERE a.owner_id = ? OR ? = 'admin' OR EXISTS (SELECT 1 FROM assessment_members m WHERE m.assessment_id = a.id AND m.user_id = ?)
       ORDER BY a.created_at DESC`,
      user.id, user.role, user.id,
    );
    return {
      assessments: rows.map((r) => ({
        id: r.id, title: r.title, status: r.status, durationMin: r.duration_min, createdAt: r.created_at,
        questions: r.questions, invited: r.invited, started: r.started, completed: r.completed,
        avgPct: r.avg_pct == null ? null : Math.round(r.avg_pct),
        role: assessmentRole(user, r),
      })),
    };
  });

  /** Dashboard overview across all of the user's assessments. */
  app.get('/api/hiring/overview', async (req) => {
    const user = requireStaff(req);
    const db = getDb();
    const owned = `s.owner_id = ? OR ? = 'admin' OR EXISTS (SELECT 1 FROM assessment_members m WHERE m.assessment_id = s.id AND m.user_id = ?)`;
    const one = (sql: string, ...p: any[]) => db.get<any>(sql, user.id, user.role, user.id, ...p).n as number;
    const weekAgo = now() - 7 * 86400_000;
    const recent = db.all<any>(
      `SELECT a.id, a.candidate_name, a.candidate_email, a.score, a.max_score, a.integrity, a.submitted_at, a.decision, s.id AS assessment_id, s.title
       FROM attempts a JOIN assessments s ON s.id = a.assessment_id
       WHERE (${owned}) AND a.status = 'submitted' AND a.decision IS NULL ORDER BY a.submitted_at DESC LIMIT 8`,
      user.id, user.role, user.id,
    );
    return {
      stats: {
        activeAssessments: one(`SELECT COUNT(*) AS n FROM assessments s WHERE (${owned}) AND s.status = 'active'`),
        inProgress: one(`SELECT COUNT(*) AS n FROM attempts a JOIN assessments s ON s.id = a.assessment_id WHERE (${owned}) AND a.status = 'in_progress'`),
        completedThisWeek: one(`SELECT COUNT(*) AS n FROM attempts a JOIN assessments s ON s.id = a.assessment_id WHERE (${owned}) AND a.status = 'submitted' AND a.submitted_at > ?`, weekAgo),
        awaitingReview: one(`SELECT COUNT(*) AS n FROM attempts a JOIN assessments s ON s.id = a.assessment_id WHERE (${owned}) AND a.status = 'submitted' AND a.decision IS NULL`),
        flagged: db.all<any>(
          `SELECT a.integrity FROM attempts a JOIN assessments s ON s.id = a.assessment_id WHERE (${owned}) AND a.status = 'submitted' AND a.decision IS NULL`,
          user.id, user.role, user.id,
        ).filter((r) => (parseJson<any>(r.integrity, null)?.level ?? 'high') !== 'high').length,
      },
      awaitingReview: recent.map((r) => {
        const integ = parseJson<any>(r.integrity, null);
        return {
          attemptId: r.id, name: r.candidate_name || r.candidate_email, assessmentId: r.assessment_id, assessment: r.title,
          scorePct: r.max_score ? Math.round((r.score / r.max_score) * 100) : null, submittedAt: r.submitted_at,
          integrity: integ ? { score: integ.score, level: integ.level } : null,
        };
      }),
    };
  });

  /** Side-by-side comparison of up to four candidates. */
  app.get('/api/assessments/:id/compare', async (req) => {
    const user = requireStaff(req);
    const asmt = ownedAssessment(user, Number((req.params as any).id));
    const ids = String((req.query as any).ids ?? '').split(',').map(Number).filter((n) => n > 0).slice(0, 4);
    const db = getDb();
    const qs = db.all<any>(
      `SELECT q.id, q.title, q.type, aq.points, aq.pool FROM assessment_questions aq JOIN questions q ON q.id = aq.question_id WHERE aq.assessment_id = ? ORDER BY aq.ord`,
      asmt.id,
    );
    const candidates = ids.map((id) => {
      const at = db.get<any>('SELECT * FROM attempts WHERE id = ? AND assessment_id = ?', id, asmt.id);
      if (!at) throw new HttpError(404, `Attempt ${id} is not part of this assessment.`);
      const drawn = new Set(attemptQuestionIds(at));
      const integ = at.status === 'invited' ? null : computeIntegrity(at.id);
      const perQ = qs.map((q) => {
        if (!drawn.has(q.id)) return { questionId: q.id, drawn: false };
        const ans = db.get<any>('SELECT * FROM answers WHERE attempt_id = ? AND question_id = ?', at.id, q.id);
        const best = ans?.best_submission_id ? db.get<any>('SELECT verdict, passed, total, language, complexity FROM submissions WHERE id = ?', ans.best_submission_id) : null;
        const cx = parseJson<any>(best?.complexity, null);
        return {
          questionId: q.id, drawn: true, score: ans?.score ?? 0,
          verdict: best?.verdict ?? null, passed: best?.passed ?? null, total: best?.total ?? null, language: best?.language ?? ans?.language ?? null,
          complexity: cx ? { estimate: cx.estimate, meetsTarget: cx.meetsTarget } : null,
        };
      });
      return {
        ...attemptSummary(at),
        integrity: integ ? { score: integ.score, level: integ.level, flags: integ.flags, counts: integ.counts } : null,
        questions: perQ,
      };
    });
    return { assessment: { id: asmt.id, title: asmt.title, durationMin: asmt.duration_min }, questions: qs, candidates };
  });

  /** The people who can see an assessment. */
  app.get('/api/assessments/:id/members', async (req) => {
    const user = requireStaff(req);
    const a = ownedAssessment(user, Number((req.params as any).id));
    const db = getDb();
    const owner = db.get<any>('SELECT id, name, email FROM users WHERE id = ?', a.owner_id);
    const members = db.all<any>('SELECT u.id, u.name, u.email, m.role, m.added_at FROM assessment_members m JOIN users u ON u.id = m.user_id WHERE m.assessment_id = ? ORDER BY m.added_at', a.id);
    return { owner, members, you: assessmentRole(user, a) };
  });

  app.post('/api/assessments/:id/members', async (req) => {
    const user = requireStaff(req);
    const a = ownedAssessment(user, Number((req.params as any).id), 'own');
    const body = z.object({ email: z.string().trim().toLowerCase().email(), role: z.enum(['reviewer', 'editor']) }).parse(req.body);
    const db = getDb();
    const target = db.get<any>('SELECT id, name, email, role FROM users WHERE email = ?', body.email);
    if (!target) throw new HttpError(404, 'No account with that email — ask them to sign up as a hiring team member first.');
    if (target.role === 'candidate') throw new HttpError(400, 'Candidates cannot join a hiring team.');
    if (target.id === a.owner_id) throw new HttpError(400, 'That person already owns this assessment.');
    db.run(
      `INSERT INTO assessment_members (assessment_id, user_id, role, added_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(assessment_id, user_id) DO UPDATE SET role = excluded.role`,
      a.id, target.id, body.role, now(),
    );
    return { ok: true, member: { id: target.id, name: target.name, email: target.email, role: body.role } };
  });

  app.delete('/api/assessments/:id/members/:userId', async (req) => {
    const user = requireStaff(req);
    const a = ownedAssessment(user, Number((req.params as any).id), 'own');
    getDb().run('DELETE FROM assessment_members WHERE assessment_id = ? AND user_id = ?', a.id, Number((req.params as any).userId));
    return { ok: true };
  });

  /** Mark one integrity flag as explained or a concern (null clears it). */
  app.put('/api/attempts/:id/flags', async (req) => {
    const user = requireStaff(req);
    const at = ownedAttempt(user, Number((req.params as any).id));
    const body = z.object({
      key: z.string().regex(/^[0-9a-f]{16}$/),
      status: z.enum(['explained', 'concern']).nullable(),
      note: z.string().max(2000).default(''),
    }).parse(req.body);
    const db = getDb();
    if (!body.status) db.run('DELETE FROM flag_reviews WHERE attempt_id = ? AND flag_key = ?', at.id, body.key);
    else {
      db.run(
        `INSERT INTO flag_reviews (attempt_id, flag_key, status, note, reviewer, updated_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(attempt_id, flag_key) DO UPDATE SET status = excluded.status, note = excluded.note, reviewer = excluded.reviewer, updated_at = excluded.updated_at`,
        at.id, body.key, body.status, body.note, user.name, now(),
      );
    }
    return { ok: true };
  });

  /** Reviewer decision and notes for an attempt. */
  app.put('/api/attempts/:id/review', async (req) => {
    const user = requireStaff(req);
    const at = ownedAttempt(user, Number((req.params as any).id));
    const body = z.object({
      decision: z.enum(['advance', 'hold', 'reject']).nullable(),
      notes: z.string().max(10_000).default(''),
    }).parse(req.body);
    getDb().run(
      'UPDATE attempts SET decision = ?, notes = ?, decided_at = ?, decided_by = ? WHERE id = ?',
      body.decision, body.notes, body.decision ? now() : null, body.decision ? user.name : null, at.id,
    );
    return { ok: true, decision: body.decision, notes: body.notes };
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
      `SELECT q.id, q.slug, q.title, q.type, q.difficulty, q.tags, aq.points, aq.ord, aq.pool FROM assessment_questions aq
       JOIN questions q ON q.id = aq.question_id WHERE aq.assessment_id = ? ORDER BY aq.ord`,
      a.id,
    ).map((q) => ({ ...q, tags: parseJson(q.tags, []) }));
    const attempts = db.all<any>('SELECT * FROM attempts WHERE assessment_id = ? ORDER BY COALESCE(score, -1) DESC, created_at DESC', a.id);
    // Per-question averages across submitted attempts.
    // Averages only over candidates who actually received the question (pools).
    const submittedAttempts = attempts.filter((t) => t.status === 'submitted');
    const perQuestion = questions.map((q) => {
      const got = submittedAttempts.filter((t) => attemptQuestionIds(t).includes(q.id));
      const total = got.reduce((sum, t) => sum + (db.get<any>('SELECT score FROM answers WHERE attempt_id = ? AND question_id = ?', t.id, q.id)?.score ?? 0), 0);
      return { questionId: q.id, avgPct: got.length ? Math.round((total / got.length / q.points) * 100) : 0, candidates: got.length };
    });
    // Per-question scores for each candidate (CSV export, comparisons).
    const scoreRows = db.all<any>(
      'SELECT an.attempt_id, an.question_id, an.score FROM answers an JOIN attempts t ON t.id = an.attempt_id WHERE t.assessment_id = ?',
      a.id,
    );
    const scores = new Map<number, Record<number, number>>();
    for (const r of scoreRows) scores.set(r.attempt_id, { ...(scores.get(r.attempt_id) ?? {}), [r.question_id]: r.score });
    return {
      assessment: {
        id: a.id, title: a.title, description: a.description, durationMin: a.duration_min, status: a.status,
        settings: assessmentSettings(a.settings), createdAt: a.created_at, role: assessmentRole(user, a),
      },
      questions,
      perQuestion,
      attempts: attempts.map((t) => ({ ...attemptSummary(t), scores: scores.get(t.id) ?? {}, questionIds: t.status === 'invited' ? null : attemptQuestionIds(t) })),
    };
  });

  app.put('/api/assessments/:id', async (req) => {
    const user = requireStaff(req);
    const a = ownedAssessment(user, Number((req.params as any).id), 'edit');
    const b = AssessmentBody.parse(req.body);
    const db = getDb();
    const started = db.get<any>("SELECT COUNT(*) AS n FROM attempts WHERE assessment_id = ? AND status != 'invited'", a.id).n;
    db.tx(() => {
      db.run(
        'UPDATE assessments SET title = ?, description = ?, duration_min = ?, settings = ?, status = ? WHERE id = ?',
        b.title, b.description, b.durationMin, JSON.stringify(b.settings), b.status, a.id,
      );
      const current = db.all<any>('SELECT question_id, points, pool FROM assessment_questions WHERE assessment_id = ? ORDER BY ord', a.id);
      const same = current.length === b.questions.length && current.every((c, i) => c.question_id === b.questions[i].questionId && (c.pool ?? null) === b.questions[i].pool);
      const prevPools = JSON.stringify(assessmentSettings(a.settings).pools);
      if ((!same || prevPools !== JSON.stringify(b.settings.pools)) && started) {
        throw new HttpError(409, 'Questions and pools cannot change once candidates have started. Points and settings can.');
      }
      db.run('DELETE FROM assessment_questions WHERE assessment_id = ?', a.id);
      b.questions.forEach((q, i) =>
        db.run('INSERT INTO assessment_questions (assessment_id, question_id, points, ord, pool) VALUES (?, ?, ?, ?, ?)', a.id, q.questionId, q.points, i, q.pool ?? null),
      );
    });
    for (const t of db.all<any>("SELECT id FROM attempts WHERE assessment_id = ? AND status != 'invited'", a.id)) recomputeAttempt(t.id);
    return { ok: true };
  });

  app.post('/api/assessments/:id/invites', async (req) => {
    const user = requireStaff(req);
    const a = ownedAssessment(user, Number((req.params as any).id), 'edit');
    const { candidates } = InviteBody.parse(req.body);
    return { invites: inviteCandidates(a.id, candidates) };
  });

  app.delete('/api/attempts/:id', async (req) => {
    const user = requireStaff(req);
    const at = ownedAttempt(user, Number((req.params as any).id), 'edit');
    if (at.status !== 'invited') throw new HttpError(409, 'Only unused invitations can be revoked.');
    deleteProctoringData(at.id); // identity photos may exist before the test starts
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
    const drawn = new Set(attemptQuestionIds(at));
    const qs = db.all<any>(
      `SELECT q.*, aq.points, aq.ord, aq.pool FROM assessment_questions aq JOIN questions q ON q.id = aq.question_id WHERE aq.assessment_id = ? ORDER BY aq.ord`,
      at.assessment_id,
    ).filter((q) => at.status === 'invited' || drawn.has(q.id));
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
        score: ans?.score ?? 0, views, pool: q.pool ?? null,
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
    const settings = assessmentSettings(asmt.settings);
    const media = db.all<any>('SELECT id, kind, t, faces, reason, bytes FROM media WHERE attempt_id = ? ORDER BY t', at.id)
      .map((m) => ({ ...m, url: `/api/media/${m.id}` }));
    const access = db.all<any>('SELECT t, ip, user_agent, fingerprint, device_id FROM access_log WHERE attempt_id = ? ORDER BY t', at.id);
    return {
      attempt: { ...attemptSummary(at), percentile, deviceLocked: !!at.device_id },
      assessment: {
        id: asmt.id, title: asmt.title, durationMin: asmt.duration_min,
        proctoring: settings.proctoring, retentionDays: settings.retentionDays, usesPools: Object.keys(settings.pools).length > 0,
      },
      media,
      access,
      role: assessmentRole(user, asmt),
      flagReviews: Object.fromEntries(db.all<any>('SELECT flag_key, status, note, reviewer, updated_at FROM flag_reviews WHERE attempt_id = ?', at.id)
        .map((f) => [f.flag_key, { status: f.status, note: f.note, reviewer: f.reviewer, updatedAt: f.updated_at }])),
      flagKeys: (integrity?.flags ?? []).map(flagKey),
      questions,
      events,
      integrity,
      ai: { enabled: aiEnabled(), review: parseJson(at.review, null) },
    };
  });

  /** Serve one proctoring image (staff who own the assessment only). */
  app.get('/api/media/:id', async (req, reply) => {
    const user = requireStaff(req);
    const m = getDb().get<any>('SELECT * FROM media WHERE id = ?', Number((req.params as any).id));
    if (!m) throw new HttpError(404, 'Image not found.');
    ownedAttempt(user, m.attempt_id);
    const file = mediaPath(m);
    if (!fs.existsSync(file)) throw new HttpError(404, 'Image not found.');
    reply.header('Cache-Control', 'private, max-age=3600').header('X-Content-Type-Options', 'nosniff').type(m.mime);
    return reply.send(fs.createReadStream(file));
  });

  /** Delete webcam images, ID photos and IP/device logs for an attempt (e.g. on a data request). */
  app.delete('/api/attempts/:id/proctoring', async (req) => {
    const user = requireStaff(req);
    const at = ownedAttempt(user, Number((req.params as any).id), 'edit');
    deleteProctoringData(at.id);
    return { ok: true };
  });

  /** Let a candidate continue in a different browser (e.g. after a crash) when the device lock is on. */
  app.post('/api/attempts/:id/unlock-device', async (req) => {
    const user = requireStaff(req);
    const at = ownedAttempt(user, Number((req.params as any).id), 'edit');
    getDb().run('UPDATE attempts SET device_id = NULL WHERE id = ?', at.id);
    getDb().run('INSERT INTO events (attempt_id, type, detail, t) VALUES (?, ?, ?, ?)', at.id, 'device_unlocked', JSON.stringify({ by: user.email }), now());
    return { ok: true };
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
