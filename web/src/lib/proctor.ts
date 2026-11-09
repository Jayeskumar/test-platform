/**
 * Browser-side proctoring helpers: device identity, camera, on-device face
 * detection and the internal clipboard used to tell in-test copies from
 * outside pastes. Video never leaves the device; only periodic snapshots do.
 */
import type { FaceDetector } from '@mediapipe/tasks-vision';

// ---------------------------------------------------------------- device identity

function randomId() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

let memoryDevice: string | null = null;
/** A random id per browser profile (localStorage), so a second browser is recognizable. */
export function deviceId(): string {
  try {
    let id = localStorage.getItem('crucible:device');
    if (!id) {
      id = randomId();
      localStorage.setItem('crucible:device', id);
    }
    return id;
  } catch {
    memoryDevice ??= randomId();
    return memoryDevice;
  }
}

async function sha256(text: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

/** A coarse device fingerprint: same hardware + browser setup tends to hash the same. */
export async function deviceFingerprint(): Promise<string> {
  const parts: Record<string, unknown> = {
    ua: navigator.userAgent,
    lang: navigator.languages?.join(','),
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    screen: [screen.width, screen.height, screen.colorDepth, devicePixelRatio].join('x'),
    cores: navigator.hardwareConcurrency,
    mem: (navigator as any).deviceMemory,
    touch: navigator.maxTouchPoints,
  };
  try {
    const c = document.createElement('canvas');
    c.width = 220;
    c.height = 30;
    const g = c.getContext('2d')!;
    g.textBaseline = 'top';
    g.font = '14px Arial';
    g.fillStyle = '#f60';
    g.fillRect(100, 1, 62, 20);
    g.fillStyle = '#069';
    g.fillText('Crucible fingerprint 🔥', 2, 15);
    parts.canvas = await sha256(c.toDataURL());
    const gl = document.createElement('canvas').getContext('webgl');
    const dbg = gl?.getExtension('WEBGL_debug_renderer_info');
    if (gl && dbg) parts.gpu = `${gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL)}|${gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)}`;
  } catch { /* best effort */ }
  return sha256(JSON.stringify(parts));
}

// ---------------------------------------------------------------- camera

let stream: MediaStream | null = null;

export const cameraLive = () => !!stream && stream.getVideoTracks().some((t) => t.readyState === 'live');

/** One camera stream for the whole test (the system check and the monitor share it). */
export async function getCamera(): Promise<MediaStream> {
  if (stream && cameraLive()) return stream;
  stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }, audio: false });
  return stream;
}

export function stopCamera() {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
}

// ---------------------------------------------------------------- face detection

let detector: Promise<FaceDetector | null> | null = null;

/** Lazily loads MediaPipe's BlazeFace model (served by this site). Resolves to null if unsupported. */
export function loadFaceDetector(): Promise<FaceDetector | null> {
  detector ??= (async () => {
    try {
      const { FaceDetector, FilesetResolver } = await import('@mediapipe/tasks-vision');
      const vision = await FilesetResolver.forVisionTasks('/mediapipe/wasm');
      return await FaceDetector.createFromOptions(vision, {
        baseOptions: { modelAssetPath: '/mediapipe/models/blaze_face_short_range.tflite', delegate: 'CPU' },
        runningMode: 'IMAGE',
        minDetectionConfidence: 0.5,
      });
    } catch (e) {
      console.warn('Face detection unavailable', e);
      return null;
    }
  })();
  return detector;
}

interface Box { x: number; y: number; w: number; h: number }

function boxesIn(d: FaceDetector, src: HTMLCanvasElement, sx: number, sw: number): Box[] {
  let input: HTMLCanvasElement = src;
  if (sx !== 0 || sw !== src.width) {
    input = document.createElement('canvas');
    input.width = sw;
    input.height = src.height;
    input.getContext('2d')!.drawImage(src, sx, 0, sw, src.height, 0, 0, sw, src.height);
  }
  return d.detect(input).detections
    .map((det) => det.boundingBox)
    .filter((b): b is NonNullable<typeof b> => !!b)
    .map((b) => ({ x: b.originX + sx, y: b.originY, w: b.width, h: b.height }));
}

const overlaps = (a: Box, b: Box) => {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return ix * iy > 0.25 * Math.min(a.w * a.h, b.w * b.h);
};

/**
 * Number of faces in an image, or null when detection is unavailable.
 * BlazeFace sees a 128px version of the frame, so smaller faces (a second person
 * further back) can vanish. The frame is also scanned as two overlapping halves,
 * which doubles their apparent size, and duplicate boxes are merged.
 */
export async function countFaces(source: HTMLCanvasElement | HTMLImageElement): Promise<number | null> {
  const d = await loadFaceDetector();
  if (!d) return null;
  try {
    let canvas: HTMLCanvasElement;
    if (source instanceof HTMLCanvasElement) canvas = source;
    else {
      canvas = document.createElement('canvas');
      canvas.width = source.naturalWidth;
      canvas.height = source.naturalHeight;
      canvas.getContext('2d')!.drawImage(source, 0, 0);
    }
    const W = canvas.width;
    const half = Math.round(W * 0.6);
    const boxes = [...boxesIn(d, canvas, 0, W), ...boxesIn(d, canvas, 0, half), ...boxesIn(d, canvas, W - half, half)];
    const merged: Box[] = [];
    for (const b of boxes) if (!merged.some((m) => overlaps(m, b))) merged.push(b);
    return merged.length;
  } catch {
    return null;
  }
}

/** Draw the current video frame to a canvas (downscaled) and encode it as JPEG. */
export function captureFrame(video: HTMLVideoElement, maxWidth = 480, quality = 0.7) {
  const w = Math.min(maxWidth, video.videoWidth || maxWidth);
  const h = Math.round(w * ((video.videoHeight || 3) / (video.videoWidth || 4)));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d')!.drawImage(video, 0, 0, w, h);
  return { canvas, dataUrl: canvas.toDataURL('image/jpeg', quality) };
}

/** Downscale an uploaded photo (e.g. of an ID card) to a JPEG data URL. */
export function resizeImageFile(file: File, maxSide = 1280, quality = 0.8): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, maxSide / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k);
      c.height = Math.round(img.height * k);
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => reject(new Error('That file is not an image we can read.'));
    img.src = URL.createObjectURL(file);
  });
}

// ---------------------------------------------------------------- lockdown

const internal: string[] = [];
const norm = (s: string) => s.replace(/\r\n?/g, '\n');
/** Remember text copied inside the test so pasting it back is allowed. */
export function rememberInternalCopy(text: string) {
  if (!text) return;
  internal.push(norm(text));
  if (internal.length > 50) internal.shift();
}
export const isInternalText = (text: string) => internal.includes(norm(text));

/** Whether more than one display is connected (Chromium; undefined elsewhere). */
export const screenIsExtended = (): boolean | undefined => (screen as any).isExtended;
