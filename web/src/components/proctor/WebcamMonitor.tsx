import { Camera, ChevronDown, ChevronUp, VideoOff } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { cx } from '../../lib/format';
import { captureFrame, countFaces, getCamera, loadFaceDetector } from '../../lib/proctor';
import { Button } from '../ui';

type Status = 'ok' | 'no_face' | 'multiple' | 'unknown';

/**
 * Runs during a proctored test: shows a small self-view, uploads a snapshot at the
 * start and roughly every `intervalSec` seconds (jittered), checks for a face every
 * few seconds, captures evidence when the candidate disappears or someone joins,
 * and blocks the test while the camera is disconnected.
 */
export function WebcamMonitor({ token, intervalSec, onEvent }: {
  token: string;
  intervalSec: number;
  onEvent: (type: 'camera_lost' | 'camera_restored', detail?: Record<string, unknown>) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [live, setLive] = useState<boolean | null>(null);
  const [status, setStatus] = useState<Status>('unknown');
  const [mini, setMini] = useState(false);
  const [lastShot, setLastShot] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lostLogged = useRef(false);
  const misses = useRef(0);
  const lastEvidence = useRef(0);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const attach = useCallback(async () => {
    try {
      const s = await getCamera();
      if (video.current) {
        video.current.srcObject = s;
        await video.current.play().catch(() => {});
      }
      for (const t of s.getVideoTracks()) {
        t.onended = () => {
          setLive(false);
          if (!lostLogged.current) { lostLogged.current = true; onEventRef.current('camera_lost'); }
        };
      }
      if (lostLogged.current) { lostLogged.current = false; onEventRef.current('camera_restored'); }
      setLive(true);
      setError(null);
      void loadFaceDetector();
    } catch (e: any) {
      setLive(false);
      setError(e?.name === 'NotAllowedError' ? 'Camera permission is blocked. Allow it in the address bar, then reconnect.' : 'No camera available. Plug it back in, then reconnect.');
      if (!lostLogged.current) { lostLogged.current = true; onEventRef.current('camera_lost', { reason: e?.name ?? 'error' }); }
    }
  }, []);

  useEffect(() => { void attach(); }, [attach]);

  const snapshot = useCallback(async (reason: 'periodic' | 'start' | 'no_face' | 'multiple_faces') => {
    const v = video.current;
    if (!v || v.readyState < 2) return;
    const { canvas, dataUrl } = captureFrame(v, 480, 0.7);
    const faces = await countFaces(canvas);
    try {
      await api.post(`/api/take/${token}/media`, { kind: 'snapshot', image: dataUrl, faces, reason });
      setLastShot(Date.now());
    } catch { /* rate limits or a finished test: nothing to do */ }
  }, [token]);

  // Scheduled snapshots: one shortly after start, then jittered intervals.
  useEffect(() => {
    if (!live) return;
    let timer: ReturnType<typeof setTimeout>;
    let first = true;
    const loop = () => {
      const delay = first ? 3000 : intervalSec * 1000 * (0.8 + Math.random() * 0.4);
      timer = setTimeout(async () => {
        await snapshot(first ? 'start' : 'periodic');
        first = false;
        loop();
      }, delay);
    };
    loop();
    return () => clearTimeout(timer);
  }, [live, intervalSec, snapshot]);

  // Presence checks between snapshots.
  useEffect(() => {
    if (!live) return;
    const id = setInterval(async () => {
      const v = video.current;
      if (!v || v.readyState < 2) return;
      const n = await countFaces(captureFrame(v, 640).canvas);
      if (n == null) return setStatus('unknown');
      const evidence = Date.now() - lastEvidence.current > 30_000;
      if (n === 1) {
        misses.current = 0;
        setStatus('ok');
      } else if (n === 0) {
        misses.current++;
        if (misses.current >= 2) {
          setStatus('no_face');
          if (evidence) { lastEvidence.current = Date.now(); void snapshot('no_face'); }
        }
      } else {
        setStatus('multiple');
        if (evidence) { lastEvidence.current = Date.now(); void snapshot('multiple_faces'); }
      }
    }, 5000);
    return () => clearInterval(id);
  }, [live, snapshot]);

  const ring = status === 'ok' ? 'ring-emerald-400' : status === 'unknown' ? 'ring-ink-500' : 'ring-rose-400';
  return (
    <>
      <div className="fixed bottom-3 left-3 z-40 w-44 overflow-hidden rounded-xl border border-ink-700 bg-ink-900/95 shadow-xl" aria-label="Proctoring camera">
        <button onClick={() => setMini(!mini)} className="flex w-full items-center gap-1.5 px-2 py-1 text-[11px] text-ink-300 hover:text-ink-100" aria-expanded={!mini}>
          <span className={cx('size-2 rounded-full', live ? (status === 'ok' || status === 'unknown' ? 'bg-emerald-400' : 'bg-rose-400') : 'bg-ink-500')} />
          {live ? 'Proctoring on' : 'Camera off'}
          {lastShot && <span className="text-ink-500" title="Time since the last snapshot">· {Math.max(0, Math.round((Date.now() - lastShot) / 1000))}s ago</span>}
          <span className="ml-auto">{mini ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}</span>
        </button>
        <div className={cx('relative aspect-[4/3] ring-2 ring-inset', ring, mini && 'hidden')}>
          <video ref={video} muted playsInline className="h-full w-full -scale-x-100 object-cover" aria-label="Your camera" />
        </div>
        {status === 'no_face' && <div role="status" className="bg-rose-500/15 px-2 py-1 text-[11px] text-rose-200">We can’t see your face — please stay in view.</div>}
        {status === 'multiple' && <div role="status" className="bg-rose-500/15 px-2 py-1 text-[11px] text-rose-200">More than one person is visible.</div>}
      </div>
      {live === false && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink-950/90 px-4" role="alertdialog" aria-modal="true" aria-labelledby="cam-title">
          <div className="max-w-md rounded-2xl border border-ink-700 bg-ink-900 p-6 text-center">
            <VideoOff className="mx-auto size-10 text-rose-400" />
            <h2 id="cam-title" className="mt-3 text-lg font-semibold text-ink-100">Camera disconnected</h2>
            <p className="mt-2 text-sm text-ink-300">This test requires your camera. Reconnect it to continue — the timer keeps running, and the interruption is recorded.</p>
            {error && <p className="mt-2 text-sm text-amber-300">{error}</p>}
            <Button variant="primary" className="mt-4" onClick={attach}><Camera className="size-4" /> Reconnect camera</Button>
          </div>
        </div>
      )}
    </>
  );
}
