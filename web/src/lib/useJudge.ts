import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import type { Submission, TestResult } from './types';

export interface JudgeState {
  id: number | null;
  kind: 'run' | 'submit' | null;
  phase: 'idle' | 'queued' | 'compiling' | 'testing' | 'complexity' | 'done' | 'error';
  compile: { ok: boolean; output: string } | null;
  results: TestResult[];
  total: number;
  submission: Submission | null;
  error: string | null;
}

const initial: JudgeState = { id: null, kind: null, phase: 'idle', compile: null, results: [], total: 0, submission: null, error: null };

/** Submit code and follow judging live over server-sent events. */
export function useJudge(opts: { attemptToken?: string; onDone?: (s: Submission) => void } = {}) {
  const [state, setState] = useState<JudgeState>(initial);
  const es = useRef<EventSource | null>(null);
  const onDone = useRef(opts.onDone);
  onDone.current = opts.onDone;

  useEffect(() => () => es.current?.close(), []);

  const follow = useCallback((id: number, kind: 'run' | 'submit') => {
    es.current?.close();
    const q = opts.attemptToken ? `?token=${encodeURIComponent(opts.attemptToken)}` : '';
    const source = new EventSource(`/api/submissions/${id}/stream${q}`);
    es.current = source;
    source.onmessage = (m) => {
      const ev = JSON.parse(m.data);
      setState((s) => {
        if (s.id !== id) return s;
        switch (ev.type) {
          case 'phase': return { ...s, phase: ev.phase };
          case 'compile': return { ...s, compile: { ok: ev.ok, output: ev.output } };
          case 'test': return { ...s, phase: 'testing', total: ev.total, results: [...s.results.filter((r) => r.index !== ev.result.index), ev.result].sort((a, b) => a.index - b.index) };
          case 'done': {
            const sub = ev.submission as Submission;
            queueMicrotask(() => onDone.current?.(sub));
            return { ...s, phase: 'done', submission: sub, results: sub.results, total: sub.results.length, compile: s.compile ?? (sub.compileOutput ? { ok: sub.verdict !== 'CE', output: sub.compileOutput } : null) };
          }
          default: return s;
        }
      });
      if (ev.type === 'done') source.close();
    };
    source.onerror = () => {
      source.close();
      // Fall back to fetching the final state once.
      setTimeout(async () => {
        try {
          const r = await api.get<{ submission: Submission }>(`/api/submissions/${id}${q}`);
          if (r.submission.status === 'done') {
            setState((s) => (s.id === id ? { ...s, phase: 'done', submission: r.submission, results: r.submission.results } : s));
            onDone.current?.(r.submission);
          } else follow(id, kind);
        } catch { /* ignore */ }
      }, 800);
    };
  }, [opts.attemptToken]);

  const submit = useCallback(async (body: { questionId: number; language: string; code: string; kind: 'run' | 'submit'; customInput?: string | null }) => {
    setState({ ...initial, phase: 'queued', kind: body.kind });
    try {
      const r = await api.post<{ id: number }>('/api/submissions', { ...body, attemptToken: opts.attemptToken });
      setState((s) => ({ ...s, id: r.id }));
      follow(r.id, body.kind);
    } catch (e: any) {
      setState({ ...initial, phase: 'error', error: e.message, kind: body.kind });
    }
  }, [follow, opts.attemptToken]);

  const reset = useCallback(() => { es.current?.close(); setState(initial); }, []);
  const busy = state.phase !== 'idle' && state.phase !== 'done' && state.phase !== 'error';
  return { state, submit, reset, busy };
}
