import { PassportStrategy } from '@nestjs/passport';
import { Strategy, type Profile } from 'passport-google-oauth20';
import type { AppConfig } from '../config/app-config';
import type { PublicUser } from '../users/user.entity';
import { AuthService } from './auth.service';
import { CookieStateStore } from './oauth-state.store';

/**
 * Google OAuth2 / OpenID Connect sign-in. Only instantiated when GOOGLE_CLIENT_ID and
 * GOOGLE_CLIENT_SECRET are set (see AuthModule), so the app runs fine without them.
 */
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(
    config: AppConfig,
    private readonly auth: AuthService,
  ) {
    super({
      clientID: config.google.clientId,
      clientSecret: config.google.clientSecret,
      callbackURL: config.google.callbackUrl,
      scope: ['openid', 'email', 'profile'],
      store: new CookieStateStore(config.httpsOnly),
    });
  }

  async validate(_accessToken: string, _refreshToken: string, profile: Profile): Promise<PublicUser> {
    const json = profile._json as { email?: string; email_verified?: boolean | string };
    const email = json.email ?? profile.emails?.[0]?.value ?? '';
    return this.auth.loginWithGoogle({
      sub: profile.id,
      email,
      emailVerified: email !== '' && String(json.email_verified) === 'true',
      name: profile.displayName ?? '',
      avatarUrl: profile.photos?.[0]?.value,
    });
  }
}
