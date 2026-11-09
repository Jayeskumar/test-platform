import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from './config.js';
import { getDb, now } from './db/index.js';

export const SESSION_COOKIE = 'crucible_session';

export interface User {
  id: number;
  email: string;
  name: string;
  role: 'candidate' | 'recruiter' | 'admin';
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const got = crypto.scryptSync(password, Buffer.from(salt, 'base64'), expected.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(expected, got);
}

export function createSession(userId: number): string {
  const token = crypto.randomBytes(32).toString('base64url');
  getDb().run('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)', token, userId, now() + config.sessionDays * 86400_000);
  return token;
}

export function setSessionCookie(reply: FastifyReply, token: string) {
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd && process.env.INSECURE_COOKIES !== '1',
    maxAge: config.sessionDays * 86400,
  });
}

export function userFromRequest(req: FastifyRequest): User | null {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return null;
  const row = getDb().get<User & { expires_at: number }>(
    `SELECT u.id, u.email, u.name, u.role, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`,
    token,
  );
  if (!row || row.expires_at < now()) return null;
  return { id: row.id, email: row.email, name: row.name, role: row.role };
}

export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export function requireUser(req: FastifyRequest): User {
  const u = userFromRequest(req);
  if (!u) throw new HttpError(401, 'Please sign in to continue.');
  return u;
}

export function requireStaff(req: FastifyRequest): User {
  const u = requireUser(req);
  if (u.role !== 'recruiter' && u.role !== 'admin') throw new HttpError(403, 'This area is for hiring teams.');
  return u;
}

export const isStaff = (u: User | null) => !!u && (u.role === 'recruiter' || u.role === 'admin');
