import { useCallback, useEffect, useState } from 'react';
import api from '../services/api';
import type { User } from '../types';

export function useAuth() {
  const [user, setUser] = useState<User | null>(() => {
    const raw = localStorage.getItem('bc_user');
    return raw ? (JSON.parse(raw) as User) : null;
  });

  const login = useCallback(async (email: string, password: string) => {
    const { data } = await api.post<{ token: string; user: User }>('/auth/login', { email, password });
    localStorage.setItem('bc_token', data.token);
    localStorage.setItem('bc_user', JSON.stringify(data.user));
    setUser(data.user);
  }, []);

  const register = useCallback(
    async (email: string, password: string, name: string, companyName: string) => {
      const { data } = await api.post<{ token: string; user: User }>('/auth/register', {
        email, password, name, companyName,
      });
      localStorage.setItem('bc_token', data.token);
      localStorage.setItem('bc_user', JSON.stringify(data.user));
      setUser(data.user);
    },
    [],
  );

  const logout = useCallback(() => {
    localStorage.removeItem('bc_token');
    localStorage.removeItem('bc_user');
    setUser(null);
  }, []);

  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === 'bc_user') {
        setUser(e.newValue ? (JSON.parse(e.newValue) as User) : null);
      }
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);

  return { user, login, register, logout };
}
