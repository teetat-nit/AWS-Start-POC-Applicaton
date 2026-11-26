import {
  ExecutionContext,
  Inject,
  Injectable,
  NotFoundException,
  createParamDecorator,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import type { PublicUser } from '../users/user.entity';

/** Requires a valid access token (cookie or Bearer). Puts the PublicUser on req.user. */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}

/**
 * Starts / completes the Google OAuth2 flow. Returns 404 when Google login is not configured.
 * On the callback, failures resolve to `req.user = undefined` so the controller can redirect
 * the browser back to the login page with an error instead of showing raw JSON.
 */
@Injectable()
export class GoogleAuthGuard extends AuthGuard('google') {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    super();
  }

  override canActivate(context: ExecutionContext) {
    if (!this.config.google.enabled) throw new NotFoundException('Google login is not enabled');
    return super.canActivate(context);
  }

  override handleRequest<TUser = PublicUser>(err: unknown, user: TUser | false): TUser {
    if (err || !user) return undefined as TUser;
    return user;
  }
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): PublicUser | undefined =>
    ctx.switchToHttp().getRequest<Request & { user?: PublicUser }>().user,
);
