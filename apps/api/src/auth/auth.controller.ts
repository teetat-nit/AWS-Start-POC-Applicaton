import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import type { PublicUser } from '../users/user.entity';
import { ACCESS_TOKEN_COOKIE, accessTokenCookieOptions } from './auth-cookie';
import { AuthService } from './auth.service';
import { LoginDto, RegisterDto } from './dto/auth.dto';
import { CurrentUser, GoogleAuthGuard, JwtAuthGuard } from './guards';

/** Strict limit on credential endpoints to slow down password guessing. */
const CREDENTIAL_LIMIT = { default: { limit: 10, ttl: 60_000 } };

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Tells the UI which sign-in options to show. */
  @Get('providers')
  providers(): { local: true; google: boolean } {
    return { local: true, google: this.config.google.enabled };
  }

  @Throttle(CREDENTIAL_LIMIT)
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PublicUser> {
    const user = await this.auth.register(dto);
    await this.setSession(res, user);
    return user;
  }

  @Throttle(CREDENTIAL_LIMIT)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PublicUser> {
    const user = await this.auth.login(dto);
    await this.setSession(res, user);
    return user;
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(@Res({ passthrough: true }) res: Response): void {
    const { maxAge: _maxAge, ...opts } = accessTokenCookieOptions(this.config);
    res.clearCookie(ACCESS_TOKEN_COOKIE, opts);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: PublicUser): PublicUser {
    return user;
  }

  /** Redirects the browser to Google's consent screen. */
  @Get('google')
  @UseGuards(GoogleAuthGuard)
  google(): void {
    // Handled by GoogleAuthGuard (passport redirect).
  }

  /** Google redirects back here. Sets the session cookie and returns to the SPA. */
  @Get('google/callback')
  @UseGuards(GoogleAuthGuard)
  async googleCallback(
    @CurrentUser() user: PublicUser | undefined,
    @Res() res: Response,
  ): Promise<void> {
    if (!user) {
      res.redirect(`${this.config.publicUrl}/login?error=google`);
      return;
    }
    await this.setSession(res, user);
    res.redirect(`${this.config.publicUrl}/`);
  }

  private async setSession(res: Response, user: PublicUser): Promise<void> {
    const token = await this.auth.issueToken(user);
    res.cookie(ACCESS_TOKEN_COOKIE, token, accessTokenCookieOptions(this.config));
  }
}
