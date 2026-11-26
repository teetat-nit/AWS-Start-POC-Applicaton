import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module';
import { DomainExceptionFilter } from './common/domain-exception.filter';
import { RequestContextMiddleware } from './common/request-context.middleware';
import { AppConfigModule } from './config/app-config.module';
import { HealthController } from './health/health.controller';

@Module({
  imports: [
    AppConfigModule,
    // Default: 100 requests / minute / client IP. Per-instance memory store (fine for a POC).
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    AuthModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: DomainExceptionFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*path');
  }
}
