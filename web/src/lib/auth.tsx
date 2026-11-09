import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { api } from './api';
import type { Meta, User } from './types';

interface AuthState {
  user: User | null;
  loading: boolean;
  meta: Meta | null;
  login: (email: string, password: string) => Promise<User>;
  register: (body: { email: string; name: string; password: string; role: 'candidate' | 'recruiter' }) => Promise<User>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [meta, setMeta] = useState<Meta | null>(null);

  useEffect(() => {
    api.get<{ user: User | null }>('/api/auth/me').then((r) => setUser(r.user)).catch(() => setUser(null)).finally(() => setLoading(false));
    api.get<Meta>('/api/meta').then(setMeta).catch(() => {});
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const r = await api.post<{ user: User }>('/api/auth/login', { email, password });
    setUser(r.user);
    return r.user;
  }, []);
  const register = useCallback(async (body: { email: string; name: string; password: string; role: 'candidate' | 'recruiter' }) => {
    const r = await api.post<{ user: User }>('/api/auth/register', body);
    setUser(r.user);
    return r.user;
  }, []);
  const logout = useCallback(async () => {
    await api.post('/api/auth/logout');
    setUser(null);
  }, []);

  return <Ctx.Provider value={{ user, loading, meta, login, register, logout }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth outside provider');
  return c;
}

export const isStaff = (u: User | null) => !!u && (u.role === 'recruiter' || u.role === 'admin');
