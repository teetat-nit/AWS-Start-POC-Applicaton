export const APP_CONFIG = Symbol('APP_CONFIG');

export type DbDriver = 'memory' | 'dynamodb';

export interface AppConfig {
  nodeEnv: string;
  isProduction: boolean;
  port: number;
  /** Origin the browser uses (Vite dev server locally, CloudFront URL in AWS). No trailing slash. */
  publicUrl: string;
  /** True when publicUrl is https: cookies get the Secure flag and helmet upgrades insecure requests. */
  httpsOnly: boolean;
  /** Directory with the built SPA to serve from the API (dev-only ALB hosting). Unset = API only. */
  webDir?: string;
  trustProxyHops: number;
  db: {
    driver: DbDriver;
    region: string;
    usersTableName: string;
    /** Only set for DynamoDB Local. */
    endpoint?: string;
  };
  jwt: {
    secret: string;
    expiresInSeconds: number;
  };
  google: {
    enabled: boolean;
    clientId: string;
    clientSecret: string;
    callbackUrl: string;
  };
}

/** Reads and validates configuration from environment variables. Fails fast on bad config. */
export function loadAppConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const errors: string[] = [];
  const nodeEnv = env.NODE_ENV ?? 'development';
  const isProduction = nodeEnv === 'production';

  const publicUrl = (env.APP_PUBLIC_URL ?? 'http://localhost:5173').replace(/\/+$/, '');
  if (!/^https?:\/\/[^/]+$/.test(publicUrl)) {
    errors.push('APP_PUBLIC_URL must be an origin like https://app.example.com');
  }

  const driver = (env.DB_DRIVER ?? 'dynamodb') as DbDriver;
  if (driver !== 'memory' && driver !== 'dynamodb') {
    errors.push('DB_DRIVER must be "memory" or "dynamodb"');
  }
  if (isProduction && driver === 'memory') {
    errors.push('DB_DRIVER=memory is not allowed in production');
  }

  const usersTableName = env.USERS_TABLE_NAME ?? '';
  if (driver === 'dynamodb' && !usersTableName) {
    errors.push('USERS_TABLE_NAME is required when DB_DRIVER=dynamodb');
  }

  const jwtSecret = env.JWT_SECRET ?? '';
  if (jwtSecret.length < 32) {
    errors.push('JWT_SECRET must be at least 32 characters');
  }

  const clientId = env.GOOGLE_CLIENT_ID?.trim() ?? '';
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim() ?? '';
  if (Boolean(clientId) !== Boolean(clientSecret)) {
    errors.push('Set both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, or neither');
  }

  if (errors.length > 0) {
    throw new Error(`Invalid configuration:\n - ${errors.join('\n - ')}`);
  }

  return {
    nodeEnv,
    isProduction,
    port: toInt(env.PORT, 3000),
    publicUrl,
    httpsOnly: publicUrl.startsWith('https://'),
    webDir: env.SERVE_WEB_DIR?.trim() || undefined,
    trustProxyHops: toInt(env.TRUST_PROXY_HOPS, 1),
    db: {
      driver,
      region: env.AWS_REGION ?? 'ap-southeast-2',
      usersTableName,
      endpoint: env.DYNAMODB_ENDPOINT || undefined,
    },
    jwt: {
      secret: jwtSecret,
      expiresInSeconds: toInt(env.JWT_EXPIRES_IN_SECONDS, 3600),
    },
    google: {
      enabled: Boolean(clientId && clientSecret),
      clientId,
      clientSecret,
      callbackUrl: `${publicUrl}/api/auth/google/callback`,
    },
  };
}

function toInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}
