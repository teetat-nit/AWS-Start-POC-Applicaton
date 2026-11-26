export type AuthProvider = 'local' | 'google';

export interface User {
  id: string;
  /** Lower-cased, trimmed. Unique across all users. */
  email: string;
  name: string;
  /** argon2id hash. Absent for users who only sign in with Google. */
  passwordHash?: string;
  /** Google account subject ("sub"). Unique across all users. */
  googleId?: string;
  avatarUrl?: string;
  createdAt: string;
  updatedAt: string;
}

/** Safe shape returned to clients: no hashes or external IDs. */
export interface PublicUser {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string;
  providers: AuthProvider[];
  createdAt: string;
}

export function toPublicUser(user: User): PublicUser {
  const providers: AuthProvider[] = [];
  if (user.passwordHash) providers.push('local');
  if (user.googleId) providers.push('google');
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    providers,
    createdAt: user.createdAt,
  };
}
