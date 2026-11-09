import { EventEmitter } from 'node:events';
import { getDb, now, parseJson } from './db/index.js';
import type { JudgeOutcome, JudgeTest, TestResult } from './judge/judge.js';
import { Judge } from './judge/judge.js';
import { Sandbox } from './judge/sandbox.js';
import { applySubmissionToAttempt } from './scoring.js';

export type JudgeEvent =
  | { type: 'phase'; phase: string }
  | { type: 'compile'; ok: boolean; output: string }
  | { type: 'test'; result: TestResult; total: number }
  | { type: 'done'; submission: any };

export interface QuestionRow {
  id: number;
  slug: string;
  type: 'coding' | 'mcq' | 'sql';
  title: string;
  difficulty: string;
  tags: string;
  statement: string;
  data: string;
  visibility: string;
  author_id: number | null;
}

export class JudgeService extends EventEmitter {
  readonly sandbox: Sandbox;
  readonly judge: Judge;
  private inflight = new Set<number>();
  /** Latest events per running submission so late SSE subscribers can catch up. */
  private replay = new Map<number, JudgeEvent[]>();

  constructor(sandbox?: Sandbox) {
    super();
    this.setMaxListeners(1000);
    this.sandbox = sandbox ?? new Sandbox();
    this.judge = new Judge(this.sandbox);
  }

  async init(opts?: { selfTest?: boolean }) {
    await this.sandbox.init(opts);
    // Anything left mid-flight by a previous process is judged again.
    const pending = getDb().all<{ id: number }>("SELECT id FROM submissions WHERE status != 'done' ORDER BY id");
    for (const p of pending) this.enqueue(p.id);
  }

  eventsFor(id: number): JudgeEvent[] {
    return this.replay.get(id) ?? [];
  }

  private emitFor(id: number, ev: JudgeEvent) {
    const list = this.replay.get(id) ?? [];
    list.push(ev);
    this.replay.set(id, list);
    this.emit(`sub:${id}`, ev);
  }

  /** Queue a submission; resolves when it has been judged. */
  enqueue(id: number): Promise<void> {
    if (this.inflight.has(id)) return this.waitFor(id);
    this.inflight.add(id);
    const p = this.process(id)
      .catch((e) => {
        getDb().run(
          "UPDATE submissions SET status = 'done', verdict = 'SE', compile_output = ?, finished_at = ? WHERE id = ?",
          `Internal judge error: ${e?.message ?? e}`, now(), id,
        );
        this.emitFor(id, { type: 'done', submission: getDb().get('SELECT * FROM submissions WHERE id = ?', id) });
      })
      .finally(() => {
        this.inflight.delete(id);
        setTimeout(() => this.replay.delete(id), 60_000);
      });
    return p;
  }

  waitFor(id: number): Promise<void> {
    return new Promise((resolve) => {
      const row = getDb().get<any>('SELECT status FROM submissions WHERE id = ?', id);
      if (!row || row.status === 'done') return resolve();
      const fn = (ev: JudgeEvent) => {
        if (ev.type === 'done') {
          this.off(`sub:${id}`, fn);
          resolve();
        }
      };
      this.on(`sub:${id}`, fn);
    });
  }

  private async process(id: number) {
    const db = getDb();
    const sub = db.get<any>('SELECT * FROM submissions WHERE id = ?', id);
    if (!sub) return;
    const q = db.get<QuestionRow>('SELECT * FROM questions WHERE id = ?', sub.question_id);
    if (!q) throw new Error('question no longer exists');
    db.run("UPDATE submissions SET status = 'running' WHERE id = ?", id);
    const data = parseJson<any>(q.data, {});
    const allTests = db.all<any>('SELECT * FROM test_cases WHERE question_id = ? ORDER BY ord, id', q.id);
    const pick = sub.kind === 'run' ? allTests.filter((t) => t.is_sample) : allTests;
    const tests: JudgeTest[] = pick.map((t) => ({ id: t.id, input: t.input, expected: t.expected, weight: t.weight, sample: !!t.is_sample }));
    if (sub.kind === 'run' && sub.custom_input != null && q.type === 'coding') {
      tests.push({ input: sub.custom_input, expected: '', weight: 0, sample: true, custom: true });
    }
    const total = tests.length;
    const ev = {
      onPhase: (phase: string) => this.emitFor(id, { type: 'phase', phase }),
      onCompile: (ok: boolean, output: string) => this.emitFor(id, { type: 'compile', ok, output }),
      onTest: (result: TestResult) => this.emitFor(id, { type: 'test', result, total }),
    };
    let outcome: JudgeOutcome;
    if (q.type === 'sql') {
      outcome = await this.judge.judgeSql({ query: sub.code, schema: data.schema ?? '', tests, ordered: !!data.ordered }, ev);
    } else if (q.type === 'coding') {
      const limits = { timeMs: data.limits?.timeMs ?? 2000, memoryMb: data.limits?.memoryMb ?? 256 };
      const wantComplexity = sub.kind === 'submit' && data.complexity?.generator && data.complexity?.sizes?.length;
      outcome = await this.judge.judgeCode(
        {
          language: sub.language,
          code: sub.code,
          tests,
          limits,
          checker: data.checker ?? { type: 'tokens' },
          complexity: wantComplexity ? { ...data.complexity, cacheKey: `q${q.id}` } : null,
        },
        ev,
      );
    } else {
      throw new Error('This question type is not judged by code.');
    }
    db.run(
      `UPDATE submissions SET status = 'done', verdict = ?, score = ?, passed = ?, total = ?, time_ms = ?, memory_kb = ?,
       compile_output = ?, results = ?, complexity = ?, finished_at = ? WHERE id = ?`,
      outcome.verdict, outcome.score, outcome.passed, outcome.total, outcome.timeMs, outcome.memoryKb,
      outcome.compileOutput, JSON.stringify(outcome.results), outcome.complexity ? JSON.stringify(outcome.complexity) : null, now(), id,
    );
    const done = db.get<any>('SELECT * FROM submissions WHERE id = ?', id);
    if (done.attempt_id) applySubmissionToAttempt(done);
    this.emitFor(id, { type: 'done', submission: done });
  }
}

let service: JudgeService | null = null;
export function getService(): JudgeService {
  if (!service) service = new JudgeService();
  return service;
}
export function setService(s: JudgeService) {
  service = s;
}
