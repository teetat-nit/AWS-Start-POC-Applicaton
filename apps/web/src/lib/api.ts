/** Typed client for the NestJS API. Same-origin (/api) so the httpOnly session cookie is sent automatically. */

export interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string;
  providers: Array<'local' | 'google'>;
  createdAt: string;
}

export interface AuthProviders {
  local: boolean;
  google: boolean;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface RegisterInput extends LoginInput {
  name: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    ...init,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...init.headers },
  });
  if (res.status === 204) return undefined as T;

  const body: unknown = await res.json().catch(() => undefined);
  if (!res.ok) {
    const message = (body as { message?: string | string[] } | undefined)?.message;
    throw new ApiError(res.status, Array.isArray(message) ? message.join(', ') : (message ?? res.statusText));
  }
  return body as T;
}

const post = <T>(path: string, data?: unknown) =>
  request<T>(path, { method: 'POST', body: data === undefined ? undefined : JSON.stringify(data) });

export const api = {
  providers: () => request<AuthProviders>('/auth/providers'),
  me: () => request<User>('/auth/me'),
  login: (input: LoginInput) => post<User>('/auth/login', input),
  register: (input: RegisterInput) => post<User>('/auth/register', input),
  logout: () => post<void>('/auth/logout'),
  /** Full-page navigation: the API redirects to Google, then back to the SPA with the cookie set. */
  googleLoginUrl: '/api/auth/google',
};
