import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

const HEADER = 'x-correlation-id';
const SAFE_ID = /^[A-Za-z0-9._-]{1,128}$/;

/** Adds a correlation ID to every request/response and writes one access-log line (no bodies, no tokens). */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.header(HEADER);
    const correlationId = incoming && SAFE_ID.test(incoming) ? incoming : randomUUID();
    res.locals.correlationId = correlationId;
    res.setHeader(HEADER, correlationId);

    const started = process.hrtime.bigint();
    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
      this.logger.log({
        correlationId,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: Math.round(durationMs),
      });
    });
    next();
  }
}
