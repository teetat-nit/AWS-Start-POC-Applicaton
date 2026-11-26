import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import {
  DomainError,
  EmailAlreadyRegisteredError,
  ExternalIdentityRejectedError,
  InvalidCredentialsError,
} from './errors';

type DomainErrorClass = abstract new (...args: never[]) => DomainError;

const STATUS_BY_ERROR = new Map<DomainErrorClass, HttpStatus>([
  [EmailAlreadyRegisteredError, HttpStatus.CONFLICT],
  [InvalidCredentialsError, HttpStatus.UNAUTHORIZED],
  [ExternalIdentityRejectedError, HttpStatus.FORBIDDEN],
]);

/** Maps domain errors to problem-details style JSON. Never leaks stack traces. */
@Catch(DomainError)
export class DomainExceptionFilter implements ExceptionFilter {
  catch(error: DomainError, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const status = STATUS_BY_ERROR.get(error.constructor as DomainErrorClass) ?? HttpStatus.BAD_REQUEST;
    res.status(status).json({ statusCode: status, error: error.name, message: error.message });
  }
}
