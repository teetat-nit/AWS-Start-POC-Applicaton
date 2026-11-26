import type { User } from './user.entity';

/**
 * Storage port for users. Implementations: DynamoDbUsersRepository (AWS / DynamoDB Local)
 * and InMemoryUsersRepository (local dev without Docker, unit tests).
 */
export abstract class UsersRepository {
  abstract findById(id: string): Promise<User | undefined>;
  abstract findByEmail(email: string): Promise<User | undefined>;
  abstract findByGoogleId(googleId: string): Promise<User | undefined>;
  /** Throws EmailAlreadyRegisteredError if the email (or Google ID) is taken. */
  abstract create(user: User): Promise<void>;
  /** Links a Google account to an existing user. */
  abstract linkGoogle(userId: string, googleId: string, avatarUrl?: string): Promise<User>;
}
