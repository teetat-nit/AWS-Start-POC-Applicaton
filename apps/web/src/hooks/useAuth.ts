import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api, type User } from '../lib/api';

const ME_KEY = ['auth', 'me'] as const;

/** Current user, or null when signed out. */
export function useCurrentUser() {
  return useQuery({
    queryKey: ME_KEY,
    queryFn: async (): Promise<User | null> => {
      try {
        return await api.me();
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function useAuthProviders() {
  return useQuery({ queryKey: ['auth', 'providers'], queryFn: api.providers, staleTime: Infinity });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: api.login, onSuccess: (user) => qc.setQueryData(ME_KEY, user) });
}

export function useRegister() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: api.register, onSuccess: (user) => qc.setQueryData(ME_KEY, user) });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.logout,
    onSuccess: () => {
      qc.setQueryData(ME_KEY, null);
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'auth' });
    },
  });
}
