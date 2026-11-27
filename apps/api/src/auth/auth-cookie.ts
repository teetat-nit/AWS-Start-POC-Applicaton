import type { CookieOptions, Request } from 'express';
import type { AppConfig } from '../config/app-config';

export const ACCESS_TOKEN_COOKIE = 'access_token';

/** httpOnly so scripts cannot read the token; SameSite=Lax blocks cross-site POSTs. */
export function accessTokenCookieOptions(config: AppConfig): CookieOptions {
  return {
    httpOnly: true,
    secure: config.httpsOnly,
    sameSite: 'lax',
    path: '/',
    maxAge: config.jwt.expiresInSeconds * 1000,
  };
}

export function readCookie(req: Request, name: string): string | undefined {
  const cookies = req.cookies as Record<string, string | undefined> | undefined;
  return cookies?.[name];
}
