import { Pause, Play } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { cx, duration } from '../lib/format';
import { CodeEditor } from './CodeEditor';

export interface Snapshot { t: number; language: string | null; code: string }

/** Scrub through how a solution was written. Large jumps (likely pastes) are marked in red. */
export function Playback({ snapshots, startedAt, pastes = [] }: { snapshots: Snapshot[]; startedAt: number; pastes?: number[] }) {
  const [i, setI] = useState(snapshots.length - 1);
  const [playing, setPlaying] = useState(false);
  useEffect(() => { setI(snapshots.length - 1); }, [snapshots.length]);
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setI((x) => { if (x >= snapshots.length - 1) { setPlaying(false); return x; } return x + 1; }), 450);
    return () => clearInterval(id);
  }, [playing, snapshots.length]);
  const jumps = useMemo(() => snapshots.map((s, k) => (k ? s.code.length - snapshots[k - 1].code.length : s.code.length)), [snapshots]);
  if (!snapshots.length) return <p className="text-sm text-ink-400">No playback recorded for this question.</p>;
  const cur = snapshots[i];
  const t0 = snapshots[0].t;
  const t1 = snapshots[snapshots.length - 1].t;
  const span = Math.max(1, t1 - t0);
  return (
    <div>
      <div className="mb-2 flex items-center gap-3">
        <button onClick={() => { if (i >= snapshots.length - 1) setI(0); setPlaying(!playing); }} className="grid size-8 place-items-center rounded-full bg-ember-500 text-ink-950 hover:bg-ember-400" aria-label={playing ? 'Pause playback' : 'Play back'}>
          {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
        </button>
        <div className="relative flex-1">
          <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded bg-ink-800" />
          {snapshots.map((s, k) => (
            <span key={k} className={cx('absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full', jumps[k] > 250 ? 'bg-rose-400' : 'bg-ink-500')} style={{ left: `${((s.t - t0) / span) * 100}%` }} title={jumps[k] > 250 ? `+${jumps[k]} chars at once` : undefined} />
          ))}
          {pastes.filter((p) => p >= t0 && p <= t1).map((p, k) => (
            <span key={`p${k}`} className="absolute top-0 h-2 w-0.5 -translate-x-1/2 bg-amber-400" style={{ left: `${((p - t0) / span) * 100}%` }} title="Paste event" />
          ))}
          <input type="range" min={0} max={snapshots.length - 1} value={i} onChange={(e) => { setPlaying(false); setI(Number(e.target.value)); }} className="relative w-full accent-ember-500 opacity-80" aria-label="Playback position" />
        </div>
        <span className="w-28 text-right font-mono text-xs text-ink-400">T+{duration(cur.t - startedAt)}</span>
      </div>
      <div className="mb-2 flex items-center gap-3 text-xs text-ink-400">
        <span>snapshot {i + 1}/{snapshots.length}</span>
        <span className={jumps[i] > 250 ? 'font-medium text-rose-300' : ''}>{jumps[i] >= 0 ? '+' : ''}{jumps[i]} chars</span>
        {jumps[i] > 250 && <span className="text-rose-300">large insertion</span>}
        <span className="ml-auto flex items-center gap-3"><span className="flex items-center gap-1"><span className="size-2 rounded-full bg-rose-400" /> sudden insertion</span><span className="flex items-center gap-1"><span className="h-2 w-0.5 bg-amber-400" /> paste</span></span>
      </div>
      <div className="h-80 overflow-hidden rounded-lg border border-ink-800">
        <CodeEditor value={cur.code} language={cur.language ?? 'python'} readOnly />
      </div>
    </div>
  );
}
