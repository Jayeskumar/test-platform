// Starts Crucible on a throwaway database for the browser tests.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const data = path.join(root, 'e2e', '.data');
fs.rmSync(data, { recursive: true, force: true });
const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', '--import', 'tsx', 'server/src/index.ts'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, PORT: process.env.E2E_PORT ?? '4300', DATA_DIR: data, SEED_DEMO: '1', NODE_ENV: 'test' },
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
child.on('exit', (code) => process.exit(code ?? 0));
