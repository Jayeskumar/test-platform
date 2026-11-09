// Copies the MediaPipe Tasks Vision WASM runtime into public/ so face detection
// is served by Crucible itself (no third-party CDN sees candidate sessions).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkg = path.dirname(require.resolve('@mediapipe/tasks-vision'));
const out = path.resolve(import.meta.dirname, '..', 'public', 'mediapipe', 'wasm');
fs.mkdirSync(out, { recursive: true });
for (const f of ['vision_wasm_internal.js', 'vision_wasm_internal.wasm']) {
  const src = path.join(pkg, 'wasm', f);
  const dst = path.join(out, f);
  if (!fs.existsSync(dst) || fs.statSync(dst).size !== fs.statSync(src).size) fs.copyFileSync(src, dst);
}
console.log('[mediapipe] runtime ready in public/mediapipe/wasm');
