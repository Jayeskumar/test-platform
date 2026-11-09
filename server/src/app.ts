import fs from 'node:fs';
import path from 'node:path';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { HttpError } from './auth.js';
import { config } from './config.js';
import { assessmentRoutes } from './routes/assessments.js';
import { authRoutes } from './routes/auth.js';
import { contestRoutes } from './routes/contests.js';
import { libraryRoutes } from './routes/library.js';
import { practiceRoutes } from './routes/practice.js';
import { takeRoutes } from './routes/take.js';

export async function buildApp(opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger ?? false,
    bodyLimit: 2 * 1024 * 1024,
    trustProxy: true,
  });
  await app.register(cookie);

  app.setErrorHandler((err: any, _req, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send({ error: err.message });
    if (err instanceof ZodError) {
      const first = err.issues[0];
      return reply.status(400).send({ error: `${first.path.join('.') || 'request'}: ${first.message}`, issues: err.issues });
    }
    if (err.statusCode && err.statusCode < 500) return reply.status(err.statusCode).send({ error: err.message });
    app.log.error(err);
    return reply.status(500).send({ error: 'Something went wrong on our side.' });
  });

  app.get('/api/health', async () => ({ ok: true }));

  await app.register(authRoutes);
  await app.register(practiceRoutes);
  await app.register(libraryRoutes);
  await app.register(assessmentRoutes);
  await app.register(takeRoutes);
  await app.register(contestRoutes);

  if (fs.existsSync(path.join(config.webDist, 'index.html'))) {
    // Serve files dynamically (a rebuilt client must not require a restart) with
    // long-lived caching for content-hashed assets and revalidation for the shell.
    await app.register(fastifyStatic, {
      root: config.webDist,
      setHeaders: (res, filePath) => {
        res.header('Cache-Control', filePath.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.status(404).send({ error: 'Not found' });
      if ((req.method !== 'GET' && req.method !== 'HEAD') || /\.[a-z0-9]+$/i.test(req.url.split('?')[0])) return reply.status(404).send('Not found');
      return reply.header('Cache-Control', 'no-cache').type('text/html').sendFile('index.html');
    });
  }
  return app;
}
