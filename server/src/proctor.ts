import type { FastifyRequest } from 'fastify';
import { HttpError } from './auth.js';
import { getDb, now, parseJson } from './db/index.js';

export const DEVICE_HEADER = 'x-crucible-device';
export const FINGERPRINT_HEADER = 'x-crucible-fp';

const clean = (v: unknown, max = 128) => (typeof v === 'string' ? v.replace(/[^\w.:-]/g, '').slice(0, max) : '') || null;

export function clientInfo(req: FastifyRequest) {
  return {
    ip: req.ip ?? null,
    userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300) || null,
    device: clean(req.headers[DEVICE_HEADER]),
    fingerprint: clean(req.headers[FINGERPRINT_HEADER]),
  };
}

/** Log where an attempt is being accessed from (only when something changed). */
export function recordAccess(attemptId: number, req: FastifyRequest) {
  const db = getDb();
  const c = clientInfo(req);
  const last = db.get<any>('SELECT ip, user_agent, fingerprint, device_id FROM access_log WHERE attempt_id = ? ORDER BY id DESC LIMIT 1', attemptId);
  if (last && last.ip === c.ip && last.fingerprint === c.fingerprint && last.device_id === c.device && last.user_agent === c.userAgent) return;
  db.run(
    'INSERT INTO access_log (attempt_id, t, ip, user_agent, fingerprint, device_id) VALUES (?, ?, ?, ?, ?, ?)',
    attemptId, now(), c.ip, c.userAgent, c.fingerprint, c.device,
  );
}

/**
 * The first browser to start a test owns it. With "lock to one device" on, other
 * browsers are refused; otherwise the switch is recorded as an integrity signal.
 */
export function enforceDevice(attempt: any, req: FastifyRequest, singleDevice: boolean) {
  const db = getDb();
  const device = clientInfo(req).device ?? 'unknown';
  if (!attempt.device_id) {
    db.run('UPDATE attempts SET device_id = ? WHERE id = ? AND device_id IS NULL', device, attempt.id);
    attempt.device_id = device;
    return;
  }
  if (attempt.device_id === device) return;
  if (singleDevice) {
    // Record each refused browser once: someone tried to open a locked test elsewhere.
    const blocked = db.get('SELECT 1 FROM events WHERE attempt_id = ? AND type = ? AND detail = ?', attempt.id, 'device_blocked', JSON.stringify({ device }));
    if (!blocked) db.run('INSERT INTO events (attempt_id, type, detail, t) VALUES (?, ?, ?, ?)', attempt.id, 'device_blocked', JSON.stringify({ device }), now());
    throw new HttpError(423, 'This test is already in progress in another browser or on another device. Continue there, or ask the hiring team to unlock it.');
  }
  const seen = db.get('SELECT 1 FROM events WHERE attempt_id = ? AND type = ? AND detail = ?', attempt.id, 'device_change', JSON.stringify({ device }));
  if (!seen) {
    db.run('INSERT INTO events (attempt_id, type, detail, t) VALUES (?, ?, ?, ?)', attempt.id, 'device_change', JSON.stringify({ device }), now());
  }
}

// ---------------------------------------------------------------- question pools

/** Small deterministic PRNG so a candidate's draw is stable and reproducible. */
function seeded(seed: string) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

export interface PoolQuestion { question_id: number; pool: string | null; ord: number }

/** Pick the questions one candidate receives: every unpooled question plus `draw` from each pool. */
export function drawQuestions(rows: PoolQuestion[], pools: Record<string, { draw: number }>, seed: string): number[] {
  const rand = seeded(seed);
  const chosen = new Set<number>();
  const byPool = new Map<string, PoolQuestion[]>();
  for (const r of rows) {
    if (!r.pool) chosen.add(r.question_id);
    else byPool.set(r.pool, [...(byPool.get(r.pool) ?? []), r]);
  }
  for (const [name, members] of byPool) {
    const draw = Math.max(1, Math.min(members.length, Math.floor(pools[name]?.draw ?? members.length)));
    const shuffled = [...members].sort((a, b) => a.question_id - b.question_id);
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    shuffled.slice(0, draw).forEach((m) => chosen.add(m.question_id));
  }
  return rows.filter((r) => chosen.has(r.question_id)).sort((a, b) => a.ord - b.ord).map((r) => r.question_id);
}

/** The question ids an attempt contains (all assessment questions for attempts without a draw). */
export function attemptQuestionIds(attempt: { assessment_id: number; question_ids?: string | null }): number[] {
  const drawn = parseJson<number[] | null>(attempt.question_ids, null);
  if (drawn) return drawn;
  return getDb().all<any>('SELECT question_id FROM assessment_questions WHERE assessment_id = ? ORDER BY ord', attempt.assessment_id).map((r) => r.question_id);
}

/** What a candidate will be given, before the draw happens (for the intro page). */
export function expectedShape(rows: { type: string; points: number; pool: string | null }[], pools: Record<string, { draw: number }>) {
  const out = { count: 0, points: 0, coding: 0, sql: 0, mcq: 0 } as Record<string, number>;
  const seenPools = new Map<string, typeof rows>();
  for (const r of rows) {
    if (!r.pool) {
      out.count++;
      out.points += r.points;
      out[r.type]++;
    } else seenPools.set(r.pool, [...(seenPools.get(r.pool) ?? []), r]);
  }
  for (const [name, members] of seenPools) {
    const draw = Math.max(1, Math.min(members.length, Math.floor(pools[name]?.draw ?? members.length)));
    out.count += draw;
    out.points += members[0].points * draw;
    out[members[0].type] += draw;
  }
  return out;
}
