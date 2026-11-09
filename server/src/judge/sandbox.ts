import { execFile, execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config, REPO_ROOT, SERVER_ROOT } from '../config.js';
import { HELLO, LANGUAGES, LANGUAGE_MAP, type LanguageDef, toolDirs } from './languages.js';

export type RunStatus = 'OK' | 'TLE' | 'MLE' | 'OLE' | 'RE' | 'SE';

export interface RunResult {
  status: RunStatus;
  exit_code: number;
  signal: number;
  cpu_ms: number;
  wall_ms: number;
  mem_kb: number;
  net_isolated: boolean;
  fs_isolated: boolean;
  error: string;
}

export interface RunOptions {
  cmd: string[];
  cwd: string;
  stdin?: string;
  stdout: string;
  stderr: string;
  cpuMs: number;
  wallMs: number;
  memKb: number;
  asKb?: number;
  fsizeKb?: number;
  nproc?: number;
  env?: Record<string, string>;
}

export interface Slot {
  index: number;
  uid: number;
  gid: number;
  cacheDir: string;
}

export interface Box {
  slot: Slot;
  /** Directory owned by the slot uid: source, binaries, scratch. */
  dir: string;
  /** Root-only directory for stdin/stdout/stderr files. */
  io: string;
}

export interface LanguageStatus {
  id: string;
  name: string;
  editor: string;
  available: boolean;
  version?: string;
  reason?: string;
  template: string;
}

const RUNNER_SRC = path.join(SERVER_ROOT, 'sandbox', 'runner.c');

/** Read at most `max` bytes of a file. */
export function readCapped(file: string, max: number): { text: string; truncated: boolean; size: number } {
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const size = fs.fstatSync(fd).size;
      const buf = Buffer.alloc(Math.min(size, max));
      fs.readSync(fd, buf, 0, buf.length, 0);
      return { text: buf.toString('utf8'), truncated: size > max, size };
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return { text: '', truncated: false, size: 0 };
  }
}

export class Sandbox {
  readonly isRoot = process.getuid?.() === 0;
  readonly runnerPath: string;
  private slots: Slot[] = [];
  private free: Slot[] = [];
  private waiters: ((s: Slot) => void)[] = [];
  private hidden: string[] = [];
  languages: LanguageStatus[] = [];
  isolation = { network: false, filesystem: false, users: false };

  constructor(readonly workers = config.workers, readonly boxRoot = config.boxRoot) {
    this.runnerPath = path.join(boxRoot, 'bin', 'crucible-runner');
  }

  async init({ selfTest = true } = {}): Promise<void> {
    fs.mkdirSync(path.join(this.boxRoot, 'bin'), { recursive: true });
    fs.chmodSync(this.boxRoot, 0o711);
    this.buildRunner();
    this.hidden = [...new Set([REPO_ROOT, config.dataDir, ...config.extraHidden])].filter(
      (p) => !this.boxRoot.startsWith(p + path.sep),
    );
    for (let i = 0; i < this.workers; i++) {
      const uid = config.uidBase + i;
      const cacheDir = path.join(this.boxRoot, 'cache', `slot-${i}`);
      fs.mkdirSync(cacheDir, { recursive: true });
      if (this.isRoot) {
        fs.chownSync(cacheDir, uid, uid);
        fs.chmodSync(cacheDir, 0o700);
      }
      const slot = { index: i, uid, gid: uid, cacheDir };
      this.slots.push(slot);
      this.free.push(slot);
    }
    this.isolation.users = this.isRoot;
    if (selfTest) await this.selfTest();
  }

  private buildRunner() {
    const needsBuild =
      !fs.existsSync(this.runnerPath) || fs.statSync(this.runnerPath).mtimeMs < fs.statSync(RUNNER_SRC).mtimeMs;
    if (needsBuild) {
      const tmp = `${this.runnerPath}.${process.pid}`;
      execFileSync('gcc', ['-O2', '-Wall', '-o', tmp, RUNNER_SRC], { stdio: 'pipe' });
      fs.renameSync(tmp, this.runnerPath);
    }
    fs.chmodSync(this.runnerPath, 0o755);
  }

  acquire(): Promise<Slot> {
    const s = this.free.pop();
    if (s) return Promise.resolve(s);
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  release(slot: Slot) {
    const w = this.waiters.shift();
    if (w) w(slot);
    else this.free.push(slot);
  }

  async withBox<T>(fn: (box: Box) => Promise<T>): Promise<T> {
    const slot = await this.acquire();
    const id = crypto.randomBytes(8).toString('hex');
    const dir = path.join(this.boxRoot, 'boxes', `${slot.index}-${id}`);
    const io = path.join(this.boxRoot, 'io', `${slot.index}-${id}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.mkdirSync(io, { recursive: true, mode: 0o700 });
    fs.chmodSync(path.join(this.boxRoot, 'boxes'), 0o711);
    fs.chmodSync(path.join(this.boxRoot, 'io'), 0o700);
    if (this.isRoot) {
      fs.chownSync(dir, slot.uid, slot.gid);
      fs.chmodSync(dir, 0o700);
    }
    try {
      return await fn({ slot, dir, io });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(io, { recursive: true, force: true });
      this.release(slot);
    }
  }

  baseEnv(box: Box, lang?: LanguageDef, memMb = 256): Record<string, string> {
    const PATH = [...toolDirs(), '/usr/local/bin', '/usr/bin', '/bin'].join(':');
    return {
      PATH,
      HOME: box.dir,
      TMPDIR: box.dir,
      LANG: 'C.UTF-8',
      LC_ALL: 'C.UTF-8',
      ...(lang?.env?.({ memMb, cacheDir: box.slot.cacheDir }) ?? {}),
    };
  }

  run(box: Box, o: RunOptions): Promise<RunResult> {
    const args = [
      '--cpu', String(o.cpuMs),
      '--wall', String(o.wallMs),
      '--mem', String(o.memKb),
      '--as', String(o.asKb ?? 0),
      '--fsize', String(o.fsizeKb ?? 16384),
      '--nproc', String(o.nproc ?? 64),
      '--cwd', o.cwd,
      '--stdout', o.stdout,
      '--stderr', o.stderr,
      '--nonet',
    ];
    if (o.stdin) args.push('--stdin', o.stdin);
    if (this.isRoot) args.push('--uid', String(box.slot.uid), '--gid', String(box.slot.gid));
    for (const h of this.hidden) args.push('--hide', h);
    for (const [k, v] of Object.entries(o.env ?? {})) args.push('--env', `${k}=${v}`);
    args.push('--', ...o.cmd);
    return new Promise((resolve) => {
      execFile(this.runnerPath, args, { timeout: o.wallMs + 10_000, maxBuffer: 1 << 20 }, (err, stdout) => {
        const line = stdout?.trim().split('\n').pop() ?? '';
        try {
          const r = JSON.parse(line) as RunResult;
          this.isolation.network ||= r.net_isolated;
          this.isolation.filesystem ||= r.fs_isolated;
          resolve(r);
        } catch {
          resolve({
            status: 'SE', exit_code: -1, signal: 0, cpu_ms: 0, wall_ms: 0, mem_kb: 0,
            net_isolated: false, fs_isolated: false, error: err?.message ?? `bad runner output: ${line}`,
          });
        }
      });
    });
  }

  /** Compile `source` for `lang` inside the box. Returns null on success or the compiler output. */
  async compile(box: Box, lang: LanguageDef, source: string): Promise<{ ok: boolean; output: string; result?: RunResult }> {
    const src = path.join(box.dir, lang.file);
    fs.writeFileSync(src, source);
    if (this.isRoot) fs.chownSync(src, box.slot.uid, box.slot.gid);
    if (!lang.compile) return { ok: true, output: '' };
    const out = path.join(box.io, 'compile.out');
    const result = await this.run(box, {
      cmd: lang.compile({ memMb: 256, cacheDir: box.slot.cacheDir }),
      cwd: box.dir,
      stdout: out,
      stderr: out,
      cpuMs: 30_000,
      wallMs: 45_000,
      memKb: 1536 * 1024,
      fsizeKb: 256 * 1024,
      nproc: 256,
      env: this.baseEnv(box, lang),
    });
    const output = readCapped(out, 16 * 1024).text;
    const ok = result.status === 'OK' && fs.existsSync(path.join(box.dir, 'main'))
      || (result.status === 'OK' && lang.id === 'java' && fs.existsSync(path.join(box.dir, 'Main.class')));
    let message = output;
    if (!ok && result.status === 'TLE') message = `Compilation timed out.\n${output}`;
    if (!ok && result.status === 'MLE') message = `Compiler exceeded the memory limit.\n${output}`;
    if (!ok && result.status === 'SE') message = `Compiler could not start: ${result.error}\n${output}`;
    return { ok, output: message, result };
  }

  /** Command and limits for running a compiled program. */
  execSpec(box: Box, lang: LanguageDef, timeMs: number, memMb: number) {
    const cpuMs = Math.round(timeMs * lang.timeFactor + lang.timeExtraMs);
    const memKb = (memMb + lang.memExtraMb) * 1024;
    return {
      cmd: lang.run({ memMb, cacheDir: box.slot.cacheDir }),
      cpuMs,
      wallMs: cpuMs * 2 + 1000,
      memKb,
      asKb: lang.addressLimit ? memKb + 64 * 1024 : 0,
      nproc: lang.id === 'java' || lang.id === 'go' ? 128 : 32,
      env: this.baseEnv(box, lang, memMb),
    };
  }

  private async selfTest() {
    const results = await Promise.all(
      LANGUAGES.map(async (lang): Promise<LanguageStatus> => {
        const base = { id: lang.id, name: lang.name, editor: lang.editor, template: lang.template };
        let version = '';
        try {
          const [bin, ...args] = lang.version();
          const v = spawnSync(bin, args, { encoding: 'utf8', env: { PATH: process.env.PATH ?? '' } });
          if (v.error) throw v.error;
          // Some tools (java) print their version on stderr, sometimes after JVM notices.
          const lines = `${v.stdout}\n${v.stderr}`.split('\n').map((l) => l.trim()).filter(Boolean);
          version = lines.find((l) => !/^Picked up/.test(l)) ?? '';
        } catch (e: any) {
          return { ...base, available: false, reason: `not installed (${e?.message ?? e})` };
        }
        try {
          return await this.withBox(async (box) => {
            const c = await this.compile(box, lang, HELLO[lang.id]);
            if (!c.ok) return { ...base, available: false, version, reason: `compile failed: ${c.output.slice(0, 300)}` };
            const spec = this.execSpec(box, lang, 2000, 256);
            const out = path.join(box.io, 'out');
            const r = await this.run(box, { ...spec, cwd: box.dir, stdout: out, stderr: path.join(box.io, 'err') });
            const text = readCapped(out, 1024).text.trim();
            if (r.status !== 'OK' || text !== 'ok') {
              const err = readCapped(path.join(box.io, 'err'), 400).text;
              return { ...base, available: false, version, reason: `run failed: ${r.status} ${r.error} ${err}`.trim() };
            }
            return { ...base, available: true, version };
          });
        } catch (e: any) {
          return { ...base, available: false, version, reason: String(e?.message ?? e) };
        }
      }),
    );
    this.languages = results;
  }

  language(id: string): LanguageDef | undefined {
    const status = this.languages.find((l) => l.id === id);
    if (this.languages.length && !status?.available) return undefined;
    return LANGUAGE_MAP.get(id);
  }
}
