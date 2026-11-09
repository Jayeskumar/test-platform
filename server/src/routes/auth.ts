import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createSession, hashPassword, HttpError, SESSION_COOKIE, setSessionCookie, userFromRequest, verifyPassword } from '../auth.js';
import { config } from '../config.js';
import { getDb, now } from '../db/index.js';
import { getService } from '../service.js';

const Register = z.object({
  email: z.string().trim().toLowerCase().email(),
  name: z.string().trim().min(1).max(80),
  password: z.string().min(8, 'must be at least 8 characters').max(200),
  role: z.enum(['candidate', 'recruiter']).default('candidate'),
});

const Login = z.object({ email: z.string().trim().toLowerCase(), password: z.string() });

export async function authRoutes(app: FastifyInstance) {
  app.post('/api/auth/register', async (req, reply) => {
    const body = Register.parse(req.body);
    const db = getDb();
    if (db.get('SELECT 1 FROM users WHERE email = ?', body.email)) throw new HttpError(409, 'An account with this email already exists.');
    const { id } = db.run(
      'INSERT INTO users (email, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)',
      body.email, body.name, hashPassword(body.password), body.role, now(),
    );
    setSessionCookie(reply, createSession(id));
    return { user: { id, email: body.email, name: body.name, role: body.role } };
  });

  app.post('/api/auth/login', async (req, reply) => {
    const body = Login.parse(req.body);
    const row = getDb().get<any>('SELECT * FROM users WHERE email = ?', body.email);
    if (!row || !verifyPassword(body.password, row.password_hash)) throw new HttpError(401, 'Incorrect email or password.');
    setSessionCookie(reply, createSession(row.id));
    return { user: { id: row.id, email: row.email, name: row.name, role: row.role } };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies?.[SESSION_COOKIE];
    if (token) getDb().run('DELETE FROM sessions WHERE token = ?', token);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', async (req) => ({ user: userFromRequest(req) }));

  app.get('/api/meta', async () => {
    const s = getService().sandbox;
    return {
      languages: s.languages,
      isolation: s.isolation,
      workers: s.workers,
      ai: !!config.anthropicKey,
    };
  });
}
