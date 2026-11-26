import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import {
  EmailAlreadyRegisteredError,
  ExternalIdentityRejectedError,
  InvalidCredentialsError,
} from '../common/errors';
import { toPublicUser, type PublicUser, type User } from '../users/user.entity';
import { UsersRepository } from '../users/users.repository';
import type { LoginDto, RegisterDto } from './dto/auth.dto';

export interface JwtPayload {
  sub: string;
  email: string;
}

export interface GoogleIdentity {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
  avatarUrl?: string;
}

// OWASP-recommended argon2id parameters (19 MiB, 2 iterations).
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

@Injectable()
export class AuthService {
  /** Hash used to keep login timing the same whether or not the email exists. */
  private dummyHash?: Promise<string>;

  constructor(
    private readonly users: UsersRepository,
    @Inject(JwtService) private readonly jwt: JwtService,
  ) {}

  async register(dto: RegisterDto): Promise<PublicUser> {
    const now = new Date().toISOString();
    const user: User = {
      id: randomUUID(),
      email: normalizeEmail(dto.email),
      name: dto.name.trim(),
      passwordHash: await argon2.hash(dto.password, ARGON2_OPTIONS),
      createdAt: now,
      updatedAt: now,
    };
    await this.users.create(user);
    return toPublicUser(user);
  }

  async login(dto: LoginDto): Promise<PublicUser> {
    const user = await this.users.findByEmail(normalizeEmail(dto.email));
    if (!user?.passwordHash) {
      await argon2.verify(await this.getDummyHash(), dto.password);
      throw new InvalidCredentialsError();
    }
    if (!(await argon2.verify(user.passwordHash, dto.password))) {
      throw new InvalidCredentialsError();
    }
    return toPublicUser(user);
  }

  /** Finds or creates the user for a Google sign-in, linking by verified email. */
  async loginWithGoogle(identity: GoogleIdentity): Promise<PublicUser> {
    const existing = await this.users.findByGoogleId(identity.sub);
    if (existing) return toPublicUser(existing);

    if (!identity.emailVerified) {
      throw new ExternalIdentityRejectedError('Google account email is not verified');
    }

    const email = normalizeEmail(identity.email);
    const byEmail = await this.users.findByEmail(email);
    if (byEmail) {
      return toPublicUser(await this.users.linkGoogle(byEmail.id, identity.sub, identity.avatarUrl));
    }

    const now = new Date().toISOString();
    const user: User = {
      id: randomUUID(),
      email,
      name: identity.name.trim() || email,
      googleId: identity.sub,
      avatarUrl: identity.avatarUrl,
      createdAt: now,
      updatedAt: now,
    };
    try {
      await this.users.create(user);
    } catch (err) {
      // Lost a race with a concurrent first sign-in for the same account: return the winner.
      if (err instanceof EmailAlreadyRegisteredError) {
        const winner = await this.users.findByGoogleId(identity.sub);
        if (winner) return toPublicUser(winner);
      }
      throw err;
    }
    return toPublicUser(user);
  }

  async getUser(id: string): Promise<PublicUser | undefined> {
    const user = await this.users.findById(id);
    return user ? toPublicUser(user) : undefined;
  }

  issueToken(user: PublicUser): Promise<string> {
    const payload: JwtPayload = { sub: user.id, email: user.email };
    return this.jwt.signAsync(payload);
  }

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= argon2.hash(randomUUID(), ARGON2_OPTIONS);
    return this.dummyHash;
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
