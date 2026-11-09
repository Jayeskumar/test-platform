import { getDb, now } from './db/index.js';

export interface ContestRow {
  id: number; slug: string; title: string; description: string;
  starts_at: number; ends_at: number; penalty_min: number; freeze_min: number; owner_id: number | null; created_at: number;
}

export type ContestStatus = 'upcoming' | 'running' | 'ended';

export function contestStatus(c: ContestRow, t = now()): ContestStatus {
  return t < c.starts_at ? 'upcoming' : t < c.ends_at ? 'running' : 'ended';
}

/** True while the scoreboard is frozen for participants (last `freeze_min` minutes). */
export function isFrozen(c: ContestRow, t = now()) {
  return c.freeze_min > 0 && t >= c.ends_at - c.freeze_min * 60_000 && t < c.ends_at;
}

export interface ProblemCell {
  solved: boolean;
  /** Rejected attempts before the first accepted one (or all rejected attempts if unsolved). */
  attempts: number;
  /** Minutes from the start of the contest to the first accepted submission. */
  minute: number | null;
  /** Attempts made after the freeze (shown as pending to participants). */
  pending: number;
  firstToSolve: boolean;
}

export interface StandingRow {
  rank: number;
  userId: number;
  name: string;
  solved: number;
  penalty: number;
  lastSolveMinute: number;
  cells: Record<number, ProblemCell>;
}

/**
 * ICPC-style standings: rank by problems solved, then by penalty (minutes to each
 * first accept + `penalty_min` per rejected attempt before it), then by the time of
 * the last solve. Compilation errors and system errors never count as attempts.
 * While frozen, participants see only submissions made before the freeze.
 */
export function computeStandings(c: ContestRow, opts: { frozenView?: boolean } = {}) {
  const db = getDb();
  const problems = db.all<{ question_id: number; label: string }>('SELECT question_id, label FROM contest_problems WHERE contest_id = ? ORDER BY ord', c.id);
  const entrants = db.all<{ user_id: number; name: string }>(
    'SELECT e.user_id, u.name FROM contest_entries e JOIN users u ON u.id = e.user_id WHERE e.contest_id = ?',
    c.id,
  );
  const subs = db.all<{ user_id: number; question_id: number; verdict: string | null; status: string; created_at: number }>(
    `SELECT user_id, question_id, verdict, status, created_at FROM submissions
     WHERE contest_id = ? AND kind = 'submit' AND created_at >= ? AND created_at < ? ORDER BY created_at, id`,
    c.id, c.starts_at, c.ends_at,
  );
  const freezeAt = opts.frozenView && isFrozen(c) ? c.ends_at - c.freeze_min * 60_000 : Infinity;
  const rows = new Map<number, StandingRow>();
  for (const e of entrants) {
    rows.set(e.user_id, {
      rank: 0, userId: e.user_id, name: e.name, solved: 0, penalty: 0, lastSolveMinute: 0,
      cells: Object.fromEntries(problems.map((p) => [p.question_id, { solved: false, attempts: 0, minute: null, pending: 0, firstToSolve: false }])),
    });
  }
  const firstSolve = new Map<number, { userId: number; at: number }>();
  for (const s of subs) {
    const row = rows.get(s.user_id);
    const cell = row?.cells[s.question_id];
    if (!row || !cell || cell.solved) continue;
    if (s.created_at >= freezeAt) {
      cell.pending++;
      continue;
    }
    if (s.status !== 'done') {
      cell.pending++;
      continue;
    }
    if (s.verdict === 'CE' || s.verdict === 'SE') continue;
    if (s.verdict === 'AC') {
      cell.solved = true;
      cell.minute = Math.floor((s.created_at - c.starts_at) / 60_000);
      row.solved++;
      row.penalty += cell.minute + cell.attempts * c.penalty_min;
      row.lastSolveMinute = Math.max(row.lastSolveMinute, cell.minute);
      const f = firstSolve.get(s.question_id);
      if (!f || s.created_at < f.at) firstSolve.set(s.question_id, { userId: s.user_id, at: s.created_at });
    } else {
      cell.attempts++;
    }
  }
  for (const [qid, f] of firstSolve) rows.get(f.userId)!.cells[qid].firstToSolve = true;
  const sorted = [...rows.values()].sort((a, b) => b.solved - a.solved || a.penalty - b.penalty || a.lastSolveMinute - b.lastSolveMinute || a.name.localeCompare(b.name));
  sorted.forEach((r, i) => {
    const prev = sorted[i - 1];
    r.rank = prev && prev.solved === r.solved && prev.penalty === r.penalty && prev.lastSolveMinute === r.lastSolveMinute ? prev.rank : i + 1;
  });
  const solvedBy = Object.fromEntries(problems.map((p) => [p.question_id, sorted.filter((r) => r.cells[p.question_id].solved).length]));
  const triedBy = Object.fromEntries(problems.map((p) => [p.question_id, sorted.filter((r) => r.cells[p.question_id].solved || r.cells[p.question_id].attempts > 0).length]));
  return {
    frozen: freezeAt !== Infinity,
    problems: problems.map((p) => ({ questionId: p.question_id, label: p.label, solvedBy: solvedBy[p.question_id], triedBy: triedBy[p.question_id] })),
    rows: sorted,
  };
}
