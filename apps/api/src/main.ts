import 'reflect-metadata';
import { ConsoleLogger, Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { APP_CONFIG, type AppConfig } from './config/app-config';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // JSON logs in AWS (CloudWatch Logs Insights friendly), pretty logs locally.
    logger: new ConsoleLogger({ json: process.env.NODE_ENV === 'production' }),
  });
  const config = app.get<AppConfig>(APP_CONFIG);

  // Behind CloudFront + ALB in AWS, Vite proxy locally. Needed for correct client IP (throttling).
  app.set('trust proxy', config.trustProxyHops);
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cookieParser());
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  // The SPA is served from the same origin (Vite proxy / CloudFront), so CORS is only for that origin.
  app.enableCors({ origin: config.publicUrl, credentials: true });
  app.enableShutdownHooks();

  await app.listen(config.port, '0.0.0.0');
  new Logger('Bootstrap').log(`API listening on port ${config.port}`);
}

void bootstrap();
