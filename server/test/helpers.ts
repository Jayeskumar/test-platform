import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Db, setDb } from '../src/db/index.js';
import { Sandbox } from '../src/judge/sandbox.js';
import { setMediaRoot } from '../src/media.js';
import { JudgeService, setService } from '../src/service.js';

let sandbox: Sandbox | null = null;

/** One shared sandbox per test process (the self test compiles every language). */
export async function testSandbox(): Promise<Sandbox> {
  if (!sandbox) {
    const root = fs.mkdtempSync(path.join('/var/tmp', 'crucible-test-'));
    sandbox = new Sandbox(3, root);
    await sandbox.init();
  }
  return sandbox;
}

export async function freshEnv() {
  const db = new Db(':memory:');
  setDb(db);
  setMediaRoot(fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-media-')));
  const svc = new JudgeService(await testSandbox());
  await svc.init({ selfTest: false });
  setService(svc);
  return { db, svc };
}

export const available = async (id: string) => (await testSandbox()).languages.find((l) => l.id === id)?.available ?? false;

export function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'crucible-'));
}
