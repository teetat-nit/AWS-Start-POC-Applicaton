import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';

@SkipThrottle()
@Controller('health')
export class HealthController {
  /** Used by the ALB target group health check. */
  @Get()
  check(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
