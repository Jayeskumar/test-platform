import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { REPO_ROOT } from '../src/config.js';
import type { Sandbox } from '../src/judge/sandbox.js';
import { readCapped } from '../src/judge/sandbox.js';
import { testSandbox } from './helpers.js';

let sb: Sandbox;
const py = (code: string, opts: Partial<{ cpuMs: number; memKb: number; asKb: number; fsizeKb: number; nproc: number; wallMs: number }> = {}) =>
  sb.withBox(async (box) => {
    const out = path.join(box.io, 'out');
    const err = path.join(box.io, 'err');
    const r = await sb.run(box, {
      cmd: ['python3', '-c', code], cwd: box.dir, stdout: out, stderr: err,
      cpuMs: opts.cpuMs ?? 2000, wallMs: opts.wallMs ?? 5000, memKb: opts.memKb ?? 256 * 1024, asKb: opts.asKb, fsizeKb: opts.fsizeKb, nproc: opts.nproc,
      env: sb.baseEnv(box),
    });
    return { ...r, out: readCapped(out, 1 << 20).text, err: readCapped(err, 1 << 16).text };
  });

describe('sandbox', () => {
  before(async () => { sb = await testSandbox(); });
  after(() => {});

  test('runs a program and reports CPU time and memory', async () => {
    const r = await py('print(sum(range(10**6)))');
    assert.equal(r.status, 'OK');
    assert.equal(r.out.trim(), String((10 ** 6 * (10 ** 6 - 1)) / 2));
    assert.ok(r.cpu_ms >= 1 && r.mem_kb > 1000);
  });

  test('kills infinite loops at the CPU limit', async () => {
    const r = await py('while True: pass', { cpuMs: 300 });
    assert.equal(r.status, 'TLE');
    assert.ok(r.cpu_ms < 600, `cpu ${r.cpu_ms}`);
  });

  test('kills sleeping programs at the wall limit', async () => {
    const r = await py('import time; time.sleep(10)', { wallMs: 500 });
    assert.equal(r.status, 'TLE');
  });

  test('enforces the memory limit', async () => {
    const r = await py('x = bytearray(300 * 1024 * 1024); print(len(x))', { memKb: 64 * 1024 });
    assert.equal(r.status, 'MLE');
  });

  test('detects runtime errors with exit codes', async () => {
    const r = await py('import sys; sys.exit(7)');
    assert.equal(r.status, 'RE');
    assert.equal(r.exit_code, 7);
  });

  test('caps output size', async () => {
    const r = await py('import sys\nsys.stdout.write("x" * 10**7)', { fsizeKb: 128 });
    assert.equal(r.status, 'OLE');
  });

  test('has no network access', { skip: !process.getuid || process.getuid() !== 0 }, async () => {
    const r = await py('import socket\ns = socket.socket()\ns.settimeout(2)\ntry:\n    s.connect(("1.1.1.1", 80)); print("CONNECTED")\nexcept OSError as e:\n    print("blocked", e)');
    assert.equal(r.status, 'OK');
    assert.match(r.out, /blocked/);
    assert.equal(r.net_isolated, true);
  });

  test('cannot read the application or its database', { skip: !process.getuid || process.getuid() !== 0 }, async () => {
    const r = await py(`import os\nprint(os.listdir(${JSON.stringify(REPO_ROOT)}))`);
    assert.equal(r.status, 'OK');
    assert.equal(r.out.trim(), '[]');
    assert.equal(r.fs_isolated, true);
  });

  test('runs as an unprivileged user', { skip: !process.getuid || process.getuid() !== 0 }, async () => {
    const r = await py('import os; print(os.getuid())');
    assert.notEqual(r.out.trim(), '0');
  });

  test('contains fork bombs', { skip: !process.getuid || process.getuid() !== 0 }, async () => {
    const r = await py('import os\nn = 0\ntry:\n    while True:\n        if os.fork() == 0:\n            import time; time.sleep(5); os._exit(0)\n        n += 1\nexcept OSError:\n    print("limited", n)', { nproc: 16, wallMs: 3000 });
    assert.match(r.out, /limited \d+/);
    const n = Number(r.out.trim().split(' ')[1]);
    assert.ok(n < 16, `forked ${n}`);
  });

  test('boxes are removed after use', async () => {
    let dir = '';
    await sb.withBox(async (box) => { dir = box.dir; fs.writeFileSync(path.join(box.dir, 'f'), 'x'); });
    assert.equal(fs.existsSync(dir), false);
  });

  test('language self test found the core languages', () => {
    for (const id of ['python', 'javascript', 'c', 'cpp']) {
      assert.ok(sb.languages.find((l) => l.id === id)?.available, `${id} should be available`);
    }
  });
});
