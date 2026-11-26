import { JwtService } from '@nestjs/jwt';
import {
  EmailAlreadyRegisteredError,
  ExternalIdentityRejectedError,
  InvalidCredentialsError,
} from '../common/errors';
import { InMemoryUsersRepository } from '../users/in-memory-users.repository';
import { AuthService, type JwtPayload } from './auth.service';

describe('AuthService', () => {
  const secret = 'test-secret-that-is-at-least-32-characters-long';
  let jwt: JwtService;
  let service: AuthService;

  beforeEach(() => {
    jwt = new JwtService({ secret, signOptions: { expiresIn: 60 } });
    service = new AuthService(new InMemoryUsersRepository(), jwt);
  });

  const alice = { email: '  Alice@Example.com ', password: 'correct horse battery', name: 'Alice' };

  it('registers a user with a normalised email and never exposes the hash', async () => {
    const user = await service.register(alice);
    expect(user.email).toBe('alice@example.com');
    expect(user.providers).toEqual(['local']);
    expect(user).not.toHaveProperty('passwordHash');
  });

  it('rejects a duplicate email regardless of case', async () => {
    await service.register(alice);
    await expect(service.register({ ...alice, email: 'ALICE@example.com' })).rejects.toBeInstanceOf(
      EmailAlreadyRegisteredError,
    );
  });

  it('logs in with the right password and rejects a wrong one or unknown email', async () => {
    await service.register(alice);
    await expect(service.login({ email: 'alice@example.com', password: alice.password })).resolves.toMatchObject({
      email: 'alice@example.com',
    });
    await expect(service.login({ email: 'alice@example.com', password: 'nope' })).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
    await expect(service.login({ email: 'bob@example.com', password: 'whatever' })).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
  });

  it('issues a JWT whose subject is the user id', async () => {
    const user = await service.register(alice);
    const payload = await jwt.verifyAsync<JwtPayload>(await service.issueToken(user));
    expect(payload.sub).toBe(user.id);
  });

  describe('loginWithGoogle', () => {
    const google = { sub: 'g-123', email: 'alice@example.com', emailVerified: true, name: 'Alice G' };

    it('creates a new user on first Google sign-in and reuses it after', async () => {
      const first = await service.loginWithGoogle(google);
      const second = await service.loginWithGoogle(google);
      expect(first.providers).toEqual(['google']);
      expect(second.id).toBe(first.id);
    });

    it('links Google to an existing local account with the same verified email', async () => {
      const local = await service.register(alice);
      const linked = await service.loginWithGoogle(google);
      expect(linked.id).toBe(local.id);
      expect(linked.providers).toEqual(['local', 'google']);
    });

    it('refuses an unverified Google email', async () => {
      await expect(service.loginWithGoogle({ ...google, emailVerified: false })).rejects.toBeInstanceOf(
        ExternalIdentityRejectedError,
      );
    });
  });
});
