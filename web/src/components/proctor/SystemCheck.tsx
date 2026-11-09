import { AlertTriangle, Camera, CheckCircle2, IdCard, Loader2, MonitorSmartphone, RefreshCw, Upload, UserRound } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { cx } from '../../lib/format';
import { captureFrame, countFaces, getCamera, loadFaceDetector, resizeImageFile, screenIsExtended } from '../../lib/proctor';
import { Button } from '../ui';

export interface ProctoringSettings {
  trackTabs: boolean;
  requireFullscreen: boolean;
  detectPaste: boolean;
  recordPlayback: boolean;
  webcam: boolean;
  webcamIntervalSec: number;
  identityCheck: boolean;
  blockExternalPaste: boolean;
  blockCopy: boolean;
  detectMultiMonitor: boolean;
  singleDevice: boolean;
}

type FaceState = 'loading' | 'none' | 'one' | 'many' | 'unavailable';

const FACE_LABEL: Record<FaceState, { text: string; cls: string }> = {
  loading: { text: 'Starting face detection…', cls: 'text-ink-300' },
  none: { text: 'No face detected — face the camera in good light', cls: 'text-amber-300' },
  one: { text: 'Face detected', cls: 'text-emerald-300' },
  many: { text: 'More than one person detected', cls: 'text-rose-300' },
  unavailable: { text: 'Face detection unavailable in this browser — snapshots will still be taken', cls: 'text-ink-300' },
};

function Step({ done, icon: Icon, title, children }: { done: boolean; icon: any; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <div className={cx('mt-0.5 grid size-7 shrink-0 place-items-center rounded-full', done ? 'bg-emerald-500/15 text-emerald-300' : 'bg-ink-800 text-ink-300')}>
        {done ? <CheckCircle2 className="size-4" /> : <Icon className="size-4" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-ink-100">{title}</div>
        <div className="mt-1.5">{children}</div>
      </div>
    </div>
  );
}

/**
 * Pre-test check: camera on with a visible face, identity photos uploaded, and no
 * extra displays. Calls onReady(true) once every required step is satisfied.
 */
export function SystemCheck({ token, settings, initial, onReady }: {
  token: string;
  settings: ProctoringSettings;
  initial: { selfie: boolean; document: boolean };
  onReady: (ready: boolean) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [camera, setCamera] = useState<'off' | 'starting' | 'on' | 'denied'>('off');
  const [camError, setCamError] = useState<string | null>(null);
  const [face, setFace] = useState<FaceState>('loading');
  const [sawFace, setSawFace] = useState(false);
  const [selfie, setSelfie] = useState<{ url: string | null; saved: boolean; busy: boolean; err?: string }>({ url: null, saved: initial.selfie, busy: false });
  const [doc, setDoc] = useState<{ url: string | null; saved: boolean; busy: boolean; err?: string }>({ url: null, saved: initial.document, busy: false });
  const [extended, setExtended] = useState<boolean | undefined>(screenIsExtended());
  const needCamera = settings.webcam || settings.identityCheck;

  const start = async () => {
    setCamera('starting');
    setCamError(null);
    try {
      const s = await getCamera();
      if (video.current) {
        video.current.srcObject = s;
        await video.current.play().catch(() => {});
      }
      setCamera('on');
      void loadFaceDetector();
    } catch (e: any) {
      setCamera('denied');
      setCamError(e?.name === 'NotAllowedError' ? 'Camera permission was denied. Allow camera access in your browser’s address bar, then try again.' : e?.name === 'NotFoundError' ? 'No camera was found on this device.' : `Could not start the camera (${e?.message ?? e}).`);
    }
  };

  // Live face status while the camera is on.
  useEffect(() => {
    if (camera !== 'on') return;
    let stop = false;
    const tick = async () => {
      if (stop || !video.current || video.current.readyState < 2) return;
      const n = await countFaces(captureFrame(video.current, 640).canvas);
      if (stop) return;
      const st: FaceState = n == null ? 'unavailable' : n === 0 ? 'none' : n === 1 ? 'one' : 'many';
      setFace(st);
      if (st === 'one' || st === 'unavailable') setSawFace(true);
    };
    const id = setInterval(tick, 800);
    void tick();
    return () => { stop = true; clearInterval(id); };
  }, [camera]);

  useEffect(() => {
    const s = screen as any;
    const h = () => setExtended(s.isExtended);
    s.addEventListener?.('change', h);
    return () => s.removeEventListener?.('change', h);
  }, []);

  const upload = async (kind: 'identity_selfie' | 'identity_document', image: string, faces: number | null) => {
    await api.post(`/api/take/${token}/media`, { kind, image, faces, reason: 'identity' });
  };

  const takeSelfie = async () => {
    if (!video.current) return;
    setSelfie((s) => ({ ...s, busy: true, err: undefined }));
    const { canvas, dataUrl } = captureFrame(video.current, 640, 0.8);
    const n = await countFaces(canvas);
    if (n === 0) return setSelfie((s) => ({ ...s, busy: false, err: 'No face found in that photo — try again facing the camera.' }));
    if (n != null && n > 1) return setSelfie((s) => ({ ...s, busy: false, err: 'Only you should be in the photo.' }));
    try {
      await upload('identity_selfie', dataUrl, n);
      setSelfie({ url: dataUrl, saved: true, busy: false });
    } catch (e: any) {
      setSelfie((s) => ({ ...s, busy: false, err: e.message }));
    }
  };

  const takeDocument = async (fromFile?: File) => {
    setDoc((s) => ({ ...s, busy: true, err: undefined }));
    try {
      const dataUrl = fromFile ? await resizeImageFile(fromFile) : captureFrame(video.current!, 1280, 0.85).dataUrl;
      await upload('identity_document', dataUrl, null);
      setDoc({ url: dataUrl, saved: true, busy: false });
    } catch (e: any) {
      setDoc((s) => ({ ...s, busy: false, err: e.message }));
    }
  };

  const cameraOk = !settings.webcam || (camera === 'on' && sawFace);
  const identityOk = !settings.identityCheck || (selfie.saved && doc.saved);
  const ready = cameraOk && identityOk;
  useEffect(() => { onReady(ready); }, [ready, onReady]);

  return (
    <div className="space-y-5">
      {needCamera && (
        <Step done={camera === 'on' && (!settings.webcam || sawFace)} icon={Camera} title="Camera">
          <div className="grid gap-4 sm:grid-cols-[260px_1fr]">
            <div className="relative aspect-[4/3] overflow-hidden rounded-lg border border-ink-700 bg-ink-950">
              <video ref={video} muted playsInline className={cx('h-full w-full -scale-x-100 object-cover', camera !== 'on' && 'hidden')} aria-label="Your camera preview" />
              {camera !== 'on' && <div className="absolute inset-0 grid place-items-center text-ink-500"><Camera className="size-8" /></div>}
            </div>
            <div className="space-y-2 text-sm">
              {camera === 'on' ? (
                <p className={cx('flex items-center gap-2', FACE_LABEL[face].cls)}>
                  {face === 'loading' ? <Loader2 className="size-4 animate-spin" /> : face === 'one' ? <CheckCircle2 className="size-4" /> : <AlertTriangle className="size-4" />}
                  {FACE_LABEL[face].text}
                </p>
              ) : (
                <>
                  <p className="text-ink-300">{settings.webcam ? `This test takes a webcam snapshot about every ${settings.webcamIntervalSec} seconds. Faces are detected on your device; the video itself is never uploaded.` : 'The camera is used to take your identity photos.'}</p>
                  <Button variant="primary" size="sm" onClick={start} loading={camera === 'starting'}><Camera className="size-4" /> Turn on camera</Button>
                </>
              )}
              {camError && <p role="alert" className="text-rose-300">{camError}</p>}
              {camera === 'denied' && <Button size="sm" onClick={start}><RefreshCw className="size-3.5" /> Try again</Button>}
            </div>
          </div>
        </Step>
      )}

      {settings.identityCheck && (
        <Step done={selfie.saved && doc.saved} icon={IdCard} title="Identity check">
          <p className="mb-3 text-sm text-ink-400">Take a photo of yourself and of a photo ID (passport, driving licence or national ID). The hiring team compares them with your webcam snapshots.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-ink-800 p-3">
              <div className="mb-2 flex items-center gap-2 text-sm text-ink-200"><UserRound className="size-4 text-ink-400" /> Selfie {selfie.saved && <CheckCircle2 className="size-4 text-emerald-400" />}</div>
              {selfie.url && <img src={selfie.url} alt="Your selfie" className="mb-2 aspect-[4/3] w-full rounded-md object-cover" />}
              <Button size="sm" onClick={takeSelfie} loading={selfie.busy} disabled={camera !== 'on'}>{selfie.saved ? 'Retake selfie' : 'Take selfie'}</Button>
              {camera !== 'on' && <p className="mt-1 text-xs text-ink-500">Turn on the camera first.</p>}
              {selfie.err && <p role="alert" className="mt-1 text-xs text-rose-300">{selfie.err}</p>}
            </div>
            <div className="rounded-lg border border-ink-800 p-3">
              <div className="mb-2 flex items-center gap-2 text-sm text-ink-200"><IdCard className="size-4 text-ink-400" /> Photo ID {doc.saved && <CheckCircle2 className="size-4 text-emerald-400" />}</div>
              {doc.url && <img src={doc.url} alt="Your ID" className="mb-2 aspect-[4/3] w-full rounded-md object-cover" />}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => takeDocument()} loading={doc.busy} disabled={camera !== 'on'}>Hold ID to camera</Button>
                <label className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-lg border border-ink-700 bg-ink-800 px-3 text-xs text-ink-100 hover:bg-ink-700">
                  <Upload className="size-3.5" /> Upload photo
                  <input type="file" accept="image/jpeg,image/png" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void takeDocument(f); e.target.value = ''; }} />
                </label>
              </div>
              {doc.err && <p role="alert" className="mt-1 text-xs text-rose-300">{doc.err}</p>}
            </div>
          </div>
        </Step>
      )}

      {settings.detectMultiMonitor && (
        <Step done={extended !== true} icon={MonitorSmartphone} title="Displays">
          {extended === true ? (
            <p className="text-sm text-amber-300">A second display is connected. Please disconnect it — using extra displays during the test is recorded.</p>
          ) : (
            <p className="text-sm text-ink-400">{extended === false ? 'One display detected.' : 'Please use a single display during the test.'}</p>
          )}
        </Step>
      )}
    </div>
  );
}
