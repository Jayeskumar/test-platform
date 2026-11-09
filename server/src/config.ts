import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
/** Repository root (works from both src/ and dist/). */
export const REPO_ROOT = path.resolve(here, '..', '..');
export const SERVER_ROOT = path.resolve(here, '..');

const env = process.env;
const int = (v: string | undefined, d: number) => (v && !Number.isNaN(Number(v)) ? Number(v) : d);

export const config = {
  port: int(env.PORT, 4000),
  host: env.HOST ?? '0.0.0.0',
  dataDir: path.resolve(env.DATA_DIR ?? path.join(REPO_ROOT, 'data')),
  /** Directory where per-run sandbox boxes are created. Must NOT be inside a hidden path. */
  boxRoot: path.resolve(env.BOX_ROOT ?? '/var/tmp/crucible'),
  /** Number of concurrent sandbox slots (each slot has its own uid). */
  workers: int(env.JUDGE_WORKERS, Math.max(1, Math.min(4, os.cpus().length))),
  uidBase: int(env.SANDBOX_UID_BASE, 61000),
  /** Built web client served by the API server in production. */
  webDist: path.resolve(env.WEB_DIST ?? path.join(REPO_ROOT, 'web', 'dist')),
  sessionDays: int(env.SESSION_DAYS, 14),
  anthropicKey: env.ANTHROPIC_API_KEY ?? '',
  aiModel: env.CRUCIBLE_AI_MODEL ?? 'claude-opus-5-5',
  isProd: env.NODE_ENV === 'production',
  /** Extra paths to hide from sandboxed programs (colon separated). */
  extraHidden: (env.SANDBOX_HIDE ?? '').split(':').filter(Boolean),
};

export type Config = typeof config;
