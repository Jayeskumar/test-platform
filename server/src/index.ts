import { buildApp } from './app.js';
import { config } from './config.js';
import { getDb } from './db/index.js';
import { sweepRetention } from './media.js';
import { sweepExpired } from './routes/take.js';
import { seedIfEmpty } from './seed/index.js';
import { getService } from './service.js';

async function main() {
  getDb();
  const svc = getService();
  const t0 = Date.now();
  await svc.init();
  const langs = svc.sandbox.languages;
  console.log(`[judge] ${svc.sandbox.workers} sandbox slots ready in ${Date.now() - t0} ms`);
  console.log(`[judge] isolation: users=${svc.sandbox.isolation.users} network=${svc.sandbox.isolation.network} filesystem=${svc.sandbox.isolation.filesystem}`);
  for (const l of langs) console.log(`[judge]   ${l.available ? '✓' : '✗'} ${l.name.padEnd(22)} ${l.available ? l.version ?? '' : l.reason}`);
  if (process.env.SKIP_SEED !== '1') await seedIfEmpty();
  setInterval(sweepExpired, 15_000).unref();
  // Proctoring data (webcam images, ID photos, IP/device logs) is deleted after each assessment's retention period.
  const retention = () => { const n = sweepRetention(); if (n) console.log(`[privacy] removed proctoring data for ${n} attempt(s) past retention`); };
  retention();
  setInterval(retention, 3600_000).unref();
  const app = await buildApp({ logger: process.env.LOG_REQUESTS === '1' });
  await app.listen({ port: config.port, host: config.host });
  console.log(`[http] Crucible listening on http://localhost:${config.port}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
