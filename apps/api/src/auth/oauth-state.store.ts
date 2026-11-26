import type { Request } from 'express';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type {
  Metadata,
  StateStore,
  StateStoreStoreCallback,
  StateStoreVerifyCallback,
} from 'passport-oauth2';
import { readCookie } from './auth-cookie';

const STATE_COOKIE = 'oauth_state';
const STATE_PATH = '/api/auth/google';

/**
 * Stateless OAuth2 "state" store for passport-oauth2 (we have no server session).
 * Keeps the random state in a short-lived httpOnly cookie and checks it on callback,
 * which protects the Google login from CSRF / login-forgery.
 * passport-oauth2 picks the call shape from the function's arity, so the implementations
 * below take (req, meta, cb) for store and (req, state, meta, cb) for verify.
 */
export class CookieStateStore implements StateStore {
  constructor(private readonly secure: boolean) {}

  store(req: Request, callback: StateStoreStoreCallback): void;
  store(req: Request, meta: Metadata, callback: StateStoreStoreCallback): void;
  store(
    req: Request,
    metaOrCallback: Metadata | StateStoreStoreCallback,
    callback?: StateStoreStoreCallback,
  ): void {
    const cb = typeof metaOrCallback === 'function' ? metaOrCallback : callback!;
    const state = randomBytes(24).toString('base64url');
    req.res?.cookie(STATE_COOKIE, state, {
      httpOnly: true,
      secure: this.secure,
      sameSite: 'lax',
      path: STATE_PATH,
      maxAge: 10 * 60 * 1000,
    });
    cb(null, state);
  }

  verify(req: Request, state: string, callback: StateStoreVerifyCallback): void;
  verify(req: Request, state: string, meta: Metadata, callback: StateStoreVerifyCallback): void;
  verify(
    req: Request,
    providedState: string,
    metaOrCallback: Metadata | StateStoreVerifyCallback,
    callback?: StateStoreVerifyCallback,
  ): void {
    const cb = typeof metaOrCallback === 'function' ? metaOrCallback : callback!;
    const expected = readCookie(req, STATE_COOKIE);
    req.res?.clearCookie(STATE_COOKIE, { path: STATE_PATH });
    const ok =
      typeof expected === 'string' &&
      typeof providedState === 'string' &&
      expected.length === providedState.length &&
      timingSafeEqual(Buffer.from(expected), Buffer.from(providedState));
    if (ok) cb(null, true, providedState);
    else cb(null, false, { message: 'Invalid OAuth state' });
  }
}
