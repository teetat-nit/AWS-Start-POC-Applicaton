/** Domain errors raised by services. Mapped to HTTP responses in DomainExceptionFilter. */
export abstract class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class EmailAlreadyRegisteredError extends DomainError {
  constructor() {
    super('An account with this email already exists');
  }
}

export class InvalidCredentialsError extends DomainError {
  constructor() {
    super('Invalid email or password');
  }
}

export class ExternalIdentityRejectedError extends DomainError {
  constructor(reason: string) {
    super(reason);
  }
}
