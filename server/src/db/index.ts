import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { config } from '../config.js';

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('candidate','recruiter','admin')),
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK (type IN ('coding','mcq','sql')),
  title TEXT NOT NULL,
  difficulty TEXT NOT NULL CHECK (difficulty IN ('easy','medium','hard')),
  tags TEXT NOT NULL DEFAULT '[]',
  statement TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}',
  author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','private')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS test_cases (
  id INTEGER PRIMARY KEY,
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  ord INTEGER NOT NULL DEFAULT 0,
  input TEXT NOT NULL,
  expected TEXT NOT NULL,
  is_sample INTEGER NOT NULL DEFAULT 0,
  weight REAL NOT NULL DEFAULT 1,
  explanation TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_tc_q ON test_cases(question_id, ord);

CREATE TABLE IF NOT EXISTS assessments (
  id INTEGER PRIMARY KEY,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  duration_min INTEGER NOT NULL DEFAULT 60,
  settings TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','closed')),
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS assessment_questions (
  assessment_id INTEGER NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  points INTEGER NOT NULL DEFAULT 100,
  ord INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (assessment_id, question_id)
);

CREATE TABLE IF NOT EXISTS attempts (
  id INTEGER PRIMARY KEY,
  assessment_id INTEGER NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  candidate_email TEXT NOT NULL,
  candidate_name TEXT NOT NULL DEFAULT '',
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('invited','in_progress','submitted')),
  started_at INTEGER,
  deadline_at INTEGER,
  submitted_at INTEGER,
  score REAL,
  max_score REAL,
  integrity TEXT,
  review TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attempts_a ON attempts(assessment_id);

CREATE TABLE IF NOT EXISTS answers (
  attempt_id INTEGER NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  language TEXT,
  code TEXT,
  choice TEXT,
  score REAL NOT NULL DEFAULT 0,
  best_submission_id INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (attempt_id, question_id)
);

CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  attempt_id INTEGER REFERENCES attempts(id) ON DELETE CASCADE,
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  language TEXT NOT NULL,
  code TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('run','submit')),
  custom_input TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done')),
  verdict TEXT,
  score REAL NOT NULL DEFAULT 0,
  passed INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  time_ms INTEGER,
  memory_kb INTEGER,
  compile_output TEXT,
  results TEXT,
  complexity TEXT,
  created_at INTEGER NOT NULL,
  finished_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_sub_user ON submissions(user_id, question_id);
CREATE INDEX IF NOT EXISTS idx_sub_attempt ON submissions(attempt_id, question_id);

CREATE TABLE IF NOT EXISTS snapshots (
  id INTEGER PRIMARY KEY,
  attempt_id INTEGER NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  question_id INTEGER NOT NULL,
  t INTEGER NOT NULL,
  language TEXT,
  code TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_snap ON snapshots(attempt_id, question_id, t);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  attempt_id INTEGER NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  question_id INTEGER,
  type TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '{}',
  t INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events ON events(attempt_id, t);
`;

export type Row = Record<string, SQLInputValue>;

export class Db {
  readonly raw: DatabaseSync;
  constructor(file: string) {
    if (file !== ':memory:') {
      fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    }
    this.raw = new DatabaseSync(file);
    this.raw.exec(SCHEMA);
    if (file !== ':memory:') {
      // Hidden test cases live here: never readable by sandbox uids.
      try { fs.chmodSync(file, 0o600); fs.chmodSync(path.dirname(file), 0o700); } catch { /* best effort */ }
    }
  }
  get<T = any>(sql: string, ...params: SQLInputValue[]): T | undefined {
    return this.raw.prepare(sql).get(...params) as T | undefined;
  }
  all<T = any>(sql: string, ...params: SQLInputValue[]): T[] {
    return this.raw.prepare(sql).all(...params) as T[];
  }
  run(sql: string, ...params: SQLInputValue[]) {
    const r = this.raw.prepare(sql).run(...params);
    return { changes: Number(r.changes), id: Number(r.lastInsertRowid) };
  }
  tx<T>(fn: () => T): T {
    this.raw.exec('BEGIN');
    try {
      const out = fn();
      this.raw.exec('COMMIT');
      return out;
    } catch (e) {
      this.raw.exec('ROLLBACK');
      throw e;
    }
  }
}

let instance: Db | null = null;
export function getDb(): Db {
  if (!instance) instance = new Db(process.env.DB_FILE ?? path.join(config.dataDir, 'crucible.db'));
  return instance;
}
export function setDb(db: Db) {
  instance = db;
}

export const now = () => Date.now();
export function parseJson<T>(s: unknown, fallback: T): T {
  if (typeof s !== 'string' || !s) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
}
