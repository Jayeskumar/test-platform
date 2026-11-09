import { useEffect, useMemo, useState } from 'react';

/** Milliseconds until `target`, corrected for the server clock and ticking every second. */
export function useCountdown(target: number | null, serverNow?: number) {
  const offset = useMemo(() => (serverNow ? serverNow - Date.now() : 0), [serverNow]);
  const [left, setLeft] = useState(() => (target == null ? 0 : target - (Date.now() + offset)));
  useEffect(() => {
    if (target == null) return;
    const tick = () => setLeft(target - (Date.now() + offset));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [target, offset]);
  return left;
}

export function longDuration(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d) return `${d}d ${h}h ${m}m`;
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}
