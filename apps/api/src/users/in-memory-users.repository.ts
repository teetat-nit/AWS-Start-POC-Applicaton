import { EmailAlreadyRegisteredError } from '../common/errors';
import type { User } from './user.entity';
import { UsersRepository } from './users.repository';

export class InMemoryUsersRepository extends UsersRepository {
  private readonly byId = new Map<string, User>();

  findById(id: string): Promise<User | undefined> {
    return Promise.resolve(this.clone(this.byId.get(id)));
  }

  findByEmail(email: string): Promise<User | undefined> {
    return Promise.resolve(this.clone([...this.byId.values()].find((u) => u.email === email)));
  }

  findByGoogleId(googleId: string): Promise<User | undefined> {
    return Promise.resolve(
      this.clone([...this.byId.values()].find((u) => u.googleId === googleId)),
    );
  }

  create(user: User): Promise<void> {
    const taken = [...this.byId.values()].some(
      (u) => u.email === user.email || (user.googleId && u.googleId === user.googleId),
    );
    if (taken || this.byId.has(user.id)) {
      return Promise.reject(new EmailAlreadyRegisteredError());
    }
    this.byId.set(user.id, { ...user });
    return Promise.resolve();
  }

  linkGoogle(userId: string, googleId: string, avatarUrl?: string): Promise<User> {
    const user = this.byId.get(userId);
    if (!user) return Promise.reject(new Error(`User ${userId} not found`));
    const updated: User = {
      ...user,
      googleId,
      avatarUrl: user.avatarUrl ?? avatarUrl,
      updatedAt: new Date().toISOString(),
    };
    this.byId.set(userId, updated);
    return Promise.resolve({ ...updated });
  }

  private clone(user: User | undefined): User | undefined {
    return user ? { ...user } : undefined;
  }
}
