import { loadAppConfig } from './app-config';

describe('loadAppConfig', () => {
  const base = {
    DB_DRIVER: 'memory',
    JWT_SECRET: 'x'.repeat(32),
  };

  it('disables Google login when credentials are not set', () => {
    const config = loadAppConfig(base);
    expect(config.google.enabled).toBe(false);
  });

  it('builds the Google callback URL from the public URL', () => {
    const config = loadAppConfig({
      ...base,
      APP_PUBLIC_URL: 'https://app.example.com/',
      GOOGLE_CLIENT_ID: 'id',
      GOOGLE_CLIENT_SECRET: 'secret',
    });
    expect(config.google.callbackUrl).toBe('https://app.example.com/api/auth/google/callback');
  });

  it('marks cookies Secure only for an https public URL (plain-HTTP dev hosting must still log in)', () => {
    expect(loadAppConfig({ ...base, APP_PUBLIC_URL: 'https://app.example.com' }).httpsOnly).toBe(true);
    expect(loadAppConfig({ ...base, APP_PUBLIC_URL: 'http://alb.example.com' }).httpsOnly).toBe(false);
  });

  it('serves the SPA only when SERVE_WEB_DIR is set', () => {
    expect(loadAppConfig(base).webDir).toBeUndefined();
    expect(loadAppConfig({ ...base, SERVE_WEB_DIR: '/srv/web' }).webDir).toBe('/srv/web');
  });

  it('fails fast on a short JWT secret and on the memory store in production', () => {
    expect(() => loadAppConfig({ ...base, JWT_SECRET: 'short' })).toThrow(/JWT_SECRET/);
    expect(() => loadAppConfig({ ...base, NODE_ENV: 'production' })).toThrow(/DB_DRIVER=memory/);
  });
});
