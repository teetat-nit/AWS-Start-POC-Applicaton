import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import type { Request } from 'express';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import type { PublicUser } from '../users/user.entity';
import { ACCESS_TOKEN_COOKIE, readCookie } from './auth-cookie';
import { AuthService, type JwtPayload } from './auth.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    @Inject(APP_CONFIG) config: AppConfig,
    private readonly auth: AuthService,
  ) {
    super({
      // Cookie for the browser app; Bearer header for API clients and tests.
      jwtFromRequest: ExtractJwt.fromExtractors([
        (req: Request) => readCookie(req, ACCESS_TOKEN_COOKIE) ?? null,
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      secretOrKey: config.jwt.secret,
      algorithms: ['HS256'],
      ignoreExpiration: false,
    });
  }

  async validate(payload: JwtPayload): Promise<PublicUser> {
    const user = await this.auth.getUser(payload.sub);
    if (!user) throw new UnauthorizedException();
    return user;
  }
}
