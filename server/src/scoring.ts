import { getDb, now, parseJson } from './db/index.js';
import { findMatches, type PlagiarismMatch } from './integrity/plagiarism.js';

export interface IntegrityReport {
  score: number;
  level: 'high' | 'medium' | 'low';
  counts: Record<string, number>;
  largePastes: number;
  pastedChars: number;
  burstEdits: number;
  plagiarism: (PlagiarismMatch & { questionId: number; questionTitle: string; copied: boolean })[];
  flags: string[];
}

export function gradeMcq(data: any, choice: unknown): boolean {
  const correct: string[] = [...(data?.correct ?? [])].sort();
  const picked: string[] = Array.isArray(choice) ? [...choice].map(String).sort() : choice != null ? [String(choice)] : [];
  return correct.length > 0 && correct.length === picked.length && correct.every((c, i) => c === picked[i]);
}

/** Recompute an attempt's total score from its answers. */
export function recomputeAttempt(attemptId: number) {
  const db = getDb();
  const attempt = db.get<any>('SELECT * FROM attempts WHERE id = ?', attemptId);
  if (!attempt) return;
  const qs = db.all<any>(
    `SELECT q.id, q.type, q.data, aq.points FROM assessment_questions aq JOIN questions q ON q.id = aq.question_id WHERE aq.assessment_id = ?`,
    attempt.assessment_id,
  );
  let score = 0;
  let max = 0;
  for (const q of qs) {
    max += q.points;
    const ans = db.get<any>('SELECT * FROM answers WHERE attempt_id = ? AND question_id = ?', attemptId, q.id);
    if (!ans) continue;
    if (q.type === 'mcq') {
      const ok = gradeMcq(parseJson(q.data, {}), parseJson(ans.choice, null));
      const s = ok ? q.points : 0;
      if (s !== ans.score) db.run('UPDATE answers SET score = ? WHERE attempt_id = ? AND question_id = ?', s, attemptId, q.id);
      score += s;
    } else {
      score += ans.score;
    }
  }
  db.run('UPDATE attempts SET score = ?, max_score = ? WHERE id = ?', Math.round(score * 100) / 100, max, attemptId);
}

/** Called when a submission finishes: keep the best score per question for the attempt. */
export function applySubmissionToAttempt(sub: { id: number; attempt_id: number; question_id: number; score: number; kind: string }) {
  if (!sub.attempt_id || sub.kind !== 'submit') return;
  const db = getDb();
  const aq = db.get<any>(
    'SELECT aq.points FROM attempts a JOIN assessment_questions aq ON aq.assessment_id = a.assessment_id WHERE a.id = ? AND aq.question_id = ?',
    sub.attempt_id,
    sub.question_id,
  );
  if (!aq) return;
  const pts = Math.round(sub.score * aq.points * 100) / 100;
  const ans = db.get<any>('SELECT * FROM answers WHERE attempt_id = ? AND question_id = ?', sub.attempt_id, sub.question_id);
  if (!ans) {
    db.run(
      'INSERT INTO answers (attempt_id, question_id, score, best_submission_id, updated_at) VALUES (?, ?, ?, ?, ?)',
      sub.attempt_id, sub.question_id, pts, sub.id, now(),
    );
  } else if (pts > ans.score || ans.best_submission_id == null) {
    db.run('UPDATE answers SET score = ?, best_submission_id = ? WHERE attempt_id = ? AND question_id = ?', Math.max(pts, ans.score), sub.id, sub.attempt_id, sub.question_id);
  }
  recomputeAttempt(sub.attempt_id);
}

/** Plagiarism across all attempts of an assessment, plus known reference solutions. */
export function assessmentPlagiarism(assessmentId: number) {
  const db = getDb();
  const qs = db.all<any>(
    `SELECT q.id, q.type, q.title, q.data FROM assessment_questions aq JOIN questions q ON q.id = aq.question_id
     WHERE aq.assessment_id = ? AND q.type IN ('coding','sql')`,
    assessmentId,
  );
  const out: (PlagiarismMatch & { questionId: number; questionTitle: string })[] = [];
  for (const q of qs) {
    const rows = db.all<any>(
      `SELECT a.id AS attempt_id, a.candidate_name, a.candidate_email, an.code FROM answers an JOIN attempts a ON a.id = an.attempt_id
       WHERE a.assessment_id = ? AND an.question_id = ? AND an.code IS NOT NULL AND a.status != 'invited'`,
      assessmentId, q.id,
    );
    const docs = rows.map((r) => ({ id: `attempt:${r.attempt_id}`, label: r.candidate_name || r.candidate_email, code: r.code as string }));
    const data = parseJson<any>(q.data, {});
    // Short SQL queries naturally converge on the reference's shape, so only coding
    // questions are compared against reference and known public solutions.
    if (q.type === 'coding') {
      const refs = [data.reference, ...(data.knownSolutions ?? [])].filter(Boolean);
      refs.forEach((r: any, i: number) =>
        docs.push({ id: `ref:${q.id}:${i}`, label: i === 0 ? 'Reference solution' : `Known public solution #${i}`, code: r.code ?? '', reference: true } as any));
    }
    for (const m of findMatches(docs)) out.push({ ...m, questionId: q.id, questionTitle: q.title });
  }
  return out;
}

export function computeIntegrity(attemptId: number, plagiarism?: ReturnType<typeof assessmentPlagiarism>): IntegrityReport {
  const db = getDb();
  const attempt = db.get<any>('SELECT * FROM attempts WHERE id = ?', attemptId);
  const events = db.all<any>('SELECT type, detail, question_id FROM events WHERE attempt_id = ?', attemptId);
  const counts: Record<string, number> = {};
  let largePastes = 0;
  let pastedChars = 0;
  /** Questions where code arrived by a large paste or a sudden insertion. */
  const copyEvidence = new Set<number>();
  for (const e of events) {
    counts[e.type] = (counts[e.type] ?? 0) + 1;
    if (e.type === 'paste') {
      const chars = Number(parseJson<any>(e.detail, {}).chars ?? 0);
      pastedChars += chars;
      if (chars >= 150) {
        largePastes++;
        if (e.question_id != null) copyEvidence.add(e.question_id);
      }
    }
  }
  // Burst edits: code grew by >250 chars between consecutive snapshots taken <4s apart.
  const snaps = db.all<any>('SELECT question_id, t, length(code) AS len FROM snapshots WHERE attempt_id = ? ORDER BY question_id, t', attemptId);
  let burstEdits = 0;
  for (let i = 1; i < snaps.length; i++) {
    const a = snaps[i - 1];
    const b = snaps[i];
    if (a.question_id === b.question_id && b.t - a.t < 4000 && b.len - a.len > 250) {
      burstEdits++;
      copyEvidence.add(b.question_id);
    }
  }
  const plag = (plagiarism ?? (attempt ? assessmentPlagiarism(attempt.assessment_id) : []))
    .filter((m) => m.a === `attempt:${attemptId}` || m.b === `attempt:${attemptId}`);

  const tab = counts.tab_hidden ?? 0;
  const fs = counts.fullscreen_exit ?? 0;
  let score = 100;
  score -= Math.min(30, tab * 4);
  score -= Math.min(20, largePastes * 7);
  score -= Math.min(10, fs * 3);
  score -= Math.min(15, burstEdits * 5);
  // A match is strong evidence only where this candidate's code arrived by paste/burst;
  // a match on code they typed incrementally more likely means someone copied *them*.
  const matches = plag.map((m) => ({ ...m, copied: copyEvidence.has(m.questionId) }));
  let plagPenalty = 0;
  for (const m of matches) {
    plagPenalty += m.copied ? Math.round(25 + (m.similarity - 0.7) * 50) : m.reference ? 15 : 5;
  }
  score -= Math.min(60, plagPenalty);
  score = Math.max(0, Math.round(score));

  const flags: string[] = [];
  if (tab >= 3) flags.push(`Left the test tab ${tab} times`);
  if (largePastes) flags.push(`${largePastes} large paste${largePastes > 1 ? 's' : ''} (${pastedChars} chars pasted in total)`);
  if (fs) flags.push(`Exited fullscreen ${fs} time${fs > 1 ? 's' : ''}`);
  if (burstEdits) flags.push(`${burstEdits} sudden code insertion${burstEdits > 1 ? 's' : ''} without typing`);
  for (const m of matches) {
    const other = m.a === `attempt:${attemptId}` ? m.bLabel : m.aLabel;
    const how = m.copied ? ' — code arrived by paste' : ' — typed incrementally here, may be the original';
    flags.push(`${Math.round(m.similarity * 100)}% similar to ${other} on “${m.questionTitle}”${how}`);
  }
  return {
    score,
    level: score >= 80 ? 'high' : score >= 50 ? 'medium' : 'low',
    counts,
    largePastes,
    pastedChars,
    burstEdits,
    plagiarism: matches,
    flags,
  };
}
