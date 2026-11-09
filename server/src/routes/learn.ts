import type { FastifyInstance } from 'fastify';
import { HttpError, isStaff, requireUser, type User, userFromRequest } from '../auth.js';
import { getDb, now, parseJson } from '../db/index.js';
import { attemptQuestionIds } from '../proctor.js';
import type { QuestionRow } from '../service.js';

/** Practice submissions needed before the editorial opens without an accepted solution. */
export const EDITORIAL_AFTER_ATTEMPTS = 3;

interface Learn { hints: string[]; editorial: string }

function learnData(q: QuestionRow): Learn {
  const data = parseJson<any>(q.data, {});
  return {
    hints: Array.isArray(data.hints) ? data.hints.filter((h: unknown) => typeof h === 'string' && h.trim()) : [],
    editorial: typeof data.editorial === 'string' ? data.editorial : '',
  };
}

/** A short summary for the practice problem page: how much help exists, without revealing it. */
export function learnSummary(q: QuestionRow) {
  const l = learnData(q);
  return { hints: l.hints.length, editorial: !!l.editorial.trim() };
}

/**
 * Hints and editorials belong to practice. They are withheld while the question is
 * part of a running contest (for everyone) or of an assessment the user is taking.
 */
function blockedReason(q: QuestionRow, user: User | null): string | null {
  const db = getDb();
  const t = now();
  const live = db.get<any>(
    `SELECT c.title FROM contest_problems cp JOIN contests c ON c.id = cp.contest_id
     WHERE cp.question_id = ? AND c.starts_at <= ? AND c.ends_at > ? LIMIT 1`,
    q.id, t, t,
  );
  if (live && !isStaff(user)) return `Hints and the editorial are unavailable while “${live.title}” is running.`;
  if (user && !isStaff(user)) {
    const attempts = db.all<any>(
      "SELECT assessment_id, question_ids FROM attempts WHERE status = 'in_progress' AND (user_id = ? OR lower(candidate_email) = lower(?))",
      user.id, user.email,
    );
    if (attempts.some((a) => attemptQuestionIds(a).includes(q.id))) return 'Hints and the editorial are unavailable while you are taking an assessment that includes this question.';
  }
  return null;
}

function practiceProgress(userId: number, questionId: number) {
  const r = getDb().get<any>(
    `SELECT COUNT(*) AS n, COALESCE(MAX(verdict = 'AC'), 0) AS ac FROM submissions
     WHERE user_id = ? AND question_id = ? AND kind = 'submit' AND attempt_id IS NULL AND contest_id IS NULL`,
    userId, questionId,
  );
  return { submits: Number(r.n), solved: !!r.ac };
}

function editorialAccess(q: QuestionRow, user: User | null) {
  if (!user) return { unlocked: false, reason: 'Sign in to unlock the editorial.' };
  if (isStaff(user)) return { unlocked: true, reason: 'Staff can always read editorials.' };
  const p = practiceProgress(user.id, q.id);
  if (p.solved) return { unlocked: true, reason: 'Unlocked by your accepted solution.' };
  if (p.submits >= EDITORIAL_AFTER_ATTEMPTS) return { unlocked: true, reason: `Unlocked after ${p.submits} attempts.` };
  const left = EDITORIAL_AFTER_ATTEMPTS - p.submits;
  return { unlocked: false, reason: `Unlocks when you solve the problem or after ${left} more submission${left === 1 ? '' : 's'}.` };
}

function referenceOf(q: QuestionRow) {
  const data = parseJson<any>(q.data, {});
  if (q.type === 'sql' && data.solution) return { language: 'sql', code: String(data.solution) };
  if (q.type === 'coding' && data.reference?.code) return { language: String(data.reference.language), code: String(data.reference.code) };
  return null;
}

function practiceQuestion(slug: string) {
  const q = getDb().get<QuestionRow>("SELECT * FROM questions WHERE slug = ? AND visibility = 'public' AND type IN ('coding','sql')", slug);
  if (!q) throw new HttpError(404, 'Problem not found.');
  return q;
}

function revealedCount(userId: number, questionId: number) {
  return Number(getDb().get<any>('SELECT COUNT(*) AS n FROM hint_views WHERE user_id = ? AND question_id = ?', userId, questionId).n);
}

export async function learnRoutes(app: FastifyInstance) {
  /** The learner's current state: hints revealed so far and whether the editorial is open. */
  app.get('/api/problems/:slug/learn', async (req) => {
    const user = userFromRequest(req);
    const q = practiceQuestion((req.params as { slug: string }).slug);
    const l = learnData(q);
    const blocked = blockedReason(q, user);
    if (blocked) return { blocked, hintCount: l.hints.length, hints: [], editorial: { available: !!l.editorial, unlocked: false, reason: blocked } };
    const shown = user ? Math.min(revealedCount(user.id, q.id), l.hints.length) : 0;
    const access = editorialAccess(q, user);
    return {
      blocked: null,
      hintCount: l.hints.length,
      hints: l.hints.slice(0, shown),
      editorial: { available: !!l.editorial.trim(), ...access },
    };
  });

  /** Reveal hints in order: hint n needs hints 1…n−1 first, so learners take the smallest step. */
  app.post('/api/problems/:slug/hints/:n', async (req) => {
    const user = requireUser(req);
    const params = req.params as { slug: string; n: string };
    const q = practiceQuestion(params.slug);
    const n = Number(params.n);
    const l = learnData(q);
    const blocked = blockedReason(q, user);
    if (blocked) throw new HttpError(403, blocked);
    if (!Number.isInteger(n) || n < 1 || n > l.hints.length) throw new HttpError(404, 'No such hint.');
    const shown = revealedCount(user.id, q.id);
    if (n > shown + 1) throw new HttpError(409, `Reveal hint ${shown + 1} first.`);
    getDb().run('INSERT OR IGNORE INTO hint_views (user_id, question_id, n, viewed_at) VALUES (?, ?, ?, ?)', user.id, q.id, n, now());
    return { n, hint: l.hints[n - 1], hints: l.hints.slice(0, Math.max(n, shown)) };
  });

  app.get('/api/problems/:slug/editorial', async (req) => {
    const user = userFromRequest(req);
    const q = practiceQuestion((req.params as { slug: string }).slug);
    const l = learnData(q);
    const blocked = blockedReason(q, user);
    if (blocked) throw new HttpError(403, blocked);
    if (!l.editorial.trim()) throw new HttpError(404, 'This problem has no editorial yet.');
    const access = editorialAccess(q, user);
    if (!access.unlocked) throw new HttpError(user ? 403 : 401, access.reason);
    return { editorial: l.editorial, reason: access.reason, reference: referenceOf(q) };
  });
}
