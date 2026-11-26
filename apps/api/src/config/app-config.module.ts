import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_CONFIG, loadAppConfig } from './app-config';

@Global()
@Module({
  // ConfigModule loads apps/api/.env into process.env (locally). In AWS, ECS injects env vars and secrets.
  imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: process.env.NODE_ENV === 'production' })],
  providers: [{ provide: APP_CONFIG, useFactory: () => loadAppConfig(process.env) }],
  exports: [APP_CONFIG],
})
export class AppConfigModule {}
