import { getDb, now, parseJson } from './db/index.js';
import { findMatches, type PlagiarismMatch } from './integrity/plagiarism.js';
import { LANGUAGE_MAP } from './judge/languages.js';
import { attemptQuestionIds } from './proctor.js';

export interface IntegrityReport {
  score: number;
  level: 'high' | 'medium' | 'low';
  counts: Record<string, number>;
  largePastes: number;
  pastedChars: number;
  burstEdits: number;
  plagiarism: (PlagiarismMatch & { questionId: number; questionTitle: string; copied: boolean })[];
  proctoring: { snapshots: number; noFace: number; multipleFaces: number; notAnalyzed: number; cameraLost: number; identity: boolean };
  access: {
    devices: number;
    networks: number;
    sharedWith: { attemptId: number; name: string; assessmentId: number; kind: 'device' | 'fingerprint' | 'network' }[];
  };
  flags: string[];
}

/**
 * Other candidates (in any assessment of the same owner) seen on the same browser,
 * the same device fingerprint, or the same network as this attempt.
 */
function sharedAccess(attempt: any) {
  const db = getDb();
  const mine = db.all<any>('SELECT DISTINCT ip, fingerprint, device_id FROM access_log WHERE attempt_id = ?', attempt.id);
  const devices = [...new Set(mine.map((r) => r.device_id).filter(Boolean))];
  const fps = [...new Set(mine.map((r) => r.fingerprint).filter(Boolean))];
  const ips = [...new Set(mine.map((r) => r.ip).filter(Boolean))];
  const owner = db.get<any>('SELECT owner_id FROM assessments WHERE id = ?', attempt.assessment_id)?.owner_id;
  const out = new Map<number, { attemptId: number; name: string; assessmentId: number; kind: 'device' | 'fingerprint' | 'network' }>();
  const rank = { device: 3, fingerprint: 2, network: 1 } as const;
  const find = (col: string, values: string[], kind: 'device' | 'fingerprint' | 'network') => {
    if (!values.length) return;
    const rows = db.all<any>(
      `SELECT DISTINCT a.id, a.candidate_name, a.candidate_email, a.assessment_id FROM access_log l
       JOIN attempts a ON a.id = l.attempt_id JOIN assessments s ON s.id = a.assessment_id
       WHERE s.owner_id = ? AND a.id != ? AND a.status != 'invited' AND l.${col} IN (${values.map(() => '?').join(',')})`,
      owner, attempt.id, ...values,
    );
    for (const r of rows) {
      const prev = out.get(r.id);
      if (!prev || rank[kind] > rank[prev.kind]) {
        out.set(r.id, { attemptId: r.id, name: r.candidate_name || r.candidate_email, assessmentId: r.assessment_id, kind });
      }
    }
  };
  // "unknown" means the client sent no device id: not evidence of anything.
  find('device_id', devices.filter((d) => d !== 'unknown'), 'device');
  find('fingerprint', fps, 'fingerprint');
  find('ip', ips, 'network');
  return { devices: Math.max(devices.length, fps.length), networks: ips.length, sharedWith: [...out.values()] };
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
  const drawn = new Set(attemptQuestionIds(attempt));
  const qs = db.all<any>(
    `SELECT q.id, q.type, q.data, aq.points FROM assessment_questions aq JOIN questions q ON q.id = aq.question_id WHERE aq.assessment_id = ?`,
    attempt.assessment_id,
  ).filter((q) => drawn.has(q.id));
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
      `SELECT a.id AS attempt_id, a.candidate_name, a.candidate_email, an.code, an.language FROM answers an JOIN attempts a ON a.id = an.attempt_id
       WHERE a.assessment_id = ? AND an.question_id = ? AND an.code IS NOT NULL AND a.status != 'invited'`,
      assessmentId, q.id,
    );
    const data = parseJson<any>(q.data, {});
    // Everyone starts from the same template: exclude it so shared boilerplate never counts as copying.
    const baseFor = (lang: string | null) => (lang ? data.starter?.[lang] ?? LANGUAGE_MAP.get(lang)?.template : undefined);
    const docs = rows.map((r) => ({ id: `attempt:${r.attempt_id}`, label: r.candidate_name || r.candidate_email, code: r.code as string, base: baseFor(r.language) }));
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

  // Webcam: share of snapshots where the candidate was not visible, or someone else was.
  const media = db.all<any>('SELECT kind, faces FROM media WHERE attempt_id = ?', attemptId);
  const shots = media.filter((m) => m.kind === 'snapshot');
  const proctoring = {
    snapshots: shots.length,
    noFace: shots.filter((m) => m.faces === 0).length,
    multipleFaces: shots.filter((m) => m.faces != null && m.faces > 1).length,
    notAnalyzed: shots.filter((m) => m.faces == null).length,
    cameraLost: counts.camera_lost ?? 0,
    identity: media.some((m) => m.kind === 'identity_selfie'),
  };
  if (proctoring.noFace >= 2 && shots.length) score -= Math.min(25, Math.round((40 * proctoring.noFace) / shots.length));
  score -= Math.min(30, proctoring.multipleFaces * 12);
  score -= Math.min(20, proctoring.cameraLost * 10);
  const settings = parseJson<any>(db.get<any>('SELECT settings FROM assessments WHERE id = ?', attempt?.assessment_id)?.settings, {});
  const webcamRequired = !!settings.proctoring?.webcam;
  const ranLong = attempt?.submitted_at && attempt?.started_at && attempt.submitted_at - attempt.started_at > 120_000;
  const noSnapshots = webcamRequired && attempt?.status === 'submitted' && ranLong && shots.length === 0;
  if (noSnapshots) score -= 20;

  // Lockdown signals.
  score -= Math.min(10, (counts.paste_blocked ?? 0) * 2);
  score -= Math.min(6, counts.copy_blocked ?? 0);
  if (counts.multi_monitor) score -= 10;
  if (counts.duplicate_tab) score -= 10;
  score -= Math.min(30, (counts.device_change ?? 0) * 15);
  score -= Math.min(20, (counts.device_blocked ?? 0) * 10);

  // Devices and networks.
  const access = attempt ? sharedAccess(attempt) : { devices: 0, networks: 0, sharedWith: [] };
  if (access.networks > 1) score -= Math.min(6, (access.networks - 1) * 2);
  for (const s of access.sharedWith) score -= s.kind === 'device' ? 25 : s.kind === 'fingerprint' ? 10 : 0;
  // A match is strong evidence only where this candidate's code arrived by paste/burst;
  // a match on code they typed incrementally more likely means someone copied *them*.
  const matches = plag.map((m) => ({ ...m, copied: copyEvidence.has(m.questionId) }));
  let plagPenalty = 0;
  for (const m of matches) {
    // Typed-up code that matches a known solution is common for canonical problems: informational only.
    plagPenalty += m.copied ? Math.round(25 + (m.similarity - 0.7) * 50) : m.reference ? 0 : 5;
  }
  score -= Math.min(60, plagPenalty);
  score = Math.max(0, Math.round(score));

  const flags: string[] = [];
  if (tab >= 3) flags.push(`Left the test tab ${tab} times`);
  if (largePastes) flags.push(`${largePastes} large paste${largePastes > 1 ? 's' : ''} (${pastedChars} chars pasted in total)`);
  if (fs) flags.push(`Exited fullscreen ${fs} time${fs > 1 ? 's' : ''}`);
  if (burstEdits) flags.push(`${burstEdits} sudden code insertion${burstEdits > 1 ? 's' : ''} without typing`);
  if (proctoring.multipleFaces) flags.push(`More than one person on camera in ${proctoring.multipleFaces} snapshot${proctoring.multipleFaces > 1 ? 's' : ''}`);
  if (proctoring.noFace >= 2) flags.push(`Not visible on camera in ${proctoring.noFace} of ${shots.length} snapshots`);
  if (proctoring.cameraLost) flags.push(`Camera disconnected ${proctoring.cameraLost} time${proctoring.cameraLost > 1 ? 's' : ''}`);
  if (noSnapshots) flags.push('Webcam was required but no snapshots were received');
  if (settings.proctoring?.identityCheck && attempt?.status !== 'invited' && !proctoring.identity) flags.push('No identity photo on file');
  if (counts.paste_blocked) flags.push(`Tried to paste from outside the test ${counts.paste_blocked} time${counts.paste_blocked > 1 ? 's' : ''} (blocked)`);
  if (counts.copy_blocked) flags.push(`Tried to copy question text ${counts.copy_blocked} time${counts.copy_blocked > 1 ? 's' : ''} (blocked)`);
  if (counts.multi_monitor) flags.push('A second display was connected');
  if (counts.duplicate_tab) flags.push('Opened the test in more than one tab');
  if (counts.device_change) flags.push(`Continued the test on ${counts.device_change} other browser${counts.device_change > 1 ? 's' : ''} or device${counts.device_change > 1 ? 's' : ''}`);
  if (counts.device_blocked) flags.push(`${counts.device_blocked} other browser${counts.device_blocked > 1 ? 's' : ''} or device${counts.device_blocked > 1 ? 's' : ''} tried to open this test (blocked by the device lock)`);
  if (access.networks > 1) flags.push(`Network (IP address) changed during the test — ${access.networks} networks seen`);
  // One flag per person and kind, even if they took several tests.
  const grouped = new Map<string, { name: string; kind: string; n: number }>();
  for (const s of access.sharedWith) {
    const k = `${s.kind}:${s.name}`;
    grouped.set(k, { name: s.name, kind: s.kind, n: (grouped.get(k)?.n ?? 0) + 1 });
  }
  for (const g of grouped.values()) {
    const who = g.n > 1 ? `${g.name} (${g.n} tests)` : g.name;
    if (g.kind === 'device') flags.push(`Same browser as ${who} — the same device took both tests`);
    else if (g.kind === 'fingerprint') flags.push(`Identical device fingerprint to ${who} — possibly the same computer`);
    else flags.push(`Same network (IP) as ${who} — common in offices and campuses; informational`);
  }
  for (const m of matches) {
    const other = m.a === `attempt:${attemptId}` ? m.bLabel : m.aLabel;
    const how = m.copied
      ? ' — code arrived by paste'
      : m.reference ? ' — typed incrementally (canonical approach; informational)' : ' — typed incrementally here, may be the original';
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
    proctoring,
    access,
    flags,
  };
}
