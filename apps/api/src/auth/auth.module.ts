import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { GoogleStrategy } from './google.strategy';
import { GoogleAuthGuard, JwtAuthGuard } from './guards';
import { JwtStrategy } from './jwt.strategy';

@Module({
  imports: [
    UsersModule,
    PassportModule.register({ session: false }),
    JwtModule.registerAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        secret: config.jwt.secret,
        signOptions: { algorithm: 'HS256', expiresIn: config.jwt.expiresInSeconds },
        verifyOptions: { algorithms: ['HS256'] },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    JwtAuthGuard,
    GoogleAuthGuard,
    {
      // Registering a PassportStrategy instance is what makes it available to passport,
      // so only create it when Google credentials are configured.
      provide: GoogleStrategy,
      inject: [APP_CONFIG, AuthService],
      useFactory: (config: AppConfig, auth: AuthService) =>
        config.google.enabled ? new GoogleStrategy(config, auth) : null,
    },
  ],
  exports: [JwtAuthGuard],
})
export class AuthModule {}
