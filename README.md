# AWS Start POC: React + NestJS + DynamoDB on AWS

A quick-start full-stack app with sign-up and sign-in, ready to deploy to AWS.

| Layer | Tech |
|---|---|
| Frontend | React 19, Vite 8, TypeScript, Tailwind CSS 4, TanStack Query, React Router 8 |
| Backend | NestJS 12 (Node.js 26 LTS), Passport (JWT + Google OAuth2), argon2id password hashing |
| Database | Amazon DynamoDB (serverless, on-demand) |
| Hosting | CloudFront + S3 (SPA), ALB + ECS Fargate (API), Secrets Manager |
| IaC / CI | AWS CDK (TypeScript) with cdk-nag, GitHub Actions (OIDC to AWS) |

```
Browser ──► CloudFront ─┬─ /*      ──► S3 (React build, private, OAC + KMS)
                        └─ /api/*  ──► ALB ──► ECS Fargate (NestJS) ──► DynamoDB
                                         ▲ only accepts requests carrying CloudFront's secret header
```

The SPA and API share one origin (Vite proxy locally, CloudFront in AWS). The session is an
**httpOnly, SameSite=Lax cookie**, so no tokens are kept in `localStorage` and no CORS is needed.

## Features

- Local accounts: register / sign in / sign out with email and password (argon2id, OWASP parameters)
- Optional **Sign in with Google** (OAuth2 / OpenID Connect). It switches on when credentials are configured, and the button appears automatically
  - Links to an existing account when the Google email is verified and matches
  - CSRF-protected `state` stored in a short-lived httpOnly cookie
- Unique emails enforced in DynamoDB with conditional transactional writes (no GSI needed)
- Rate limiting on credential endpoints, input validation (unknown fields rejected), Helmet headers
- Correlation ID on every request (`x-correlation-id`), JSON logs in AWS
- Protected routes in the SPA, loading/error states

## Repository layout

```
apps/
  api/            NestJS API
    src/auth/       controller, service, JWT + Google strategies, OAuth state store
    src/users/      User entity, repository port, DynamoDB + in-memory implementations
    src/config/     env validation (fails fast on bad config)
    scripts/        create-local-table.ts (DynamoDB Local)
    Dockerfile      production image (build context = repo root)
  web/            React SPA (src/pages, src/hooks/useAuth.ts, src/lib/api.ts)
infra/            CDK app: one stack per environment (dev/uat/prod)
.github/workflows CI: lint, typecheck, test, build, cdk synth; deploy dev on main
docker-compose.yml DynamoDB Local
```

## Prerequisites

- Node.js 26 LTS (`.nvmrc`) and pnpm 12: `npm i -g pnpm@12` (or `npx pnpm@12 …`)
- Optional: Docker / Rancher Desktop (DynamoDB Local, and required for `cdk deploy` image build)
- For deploys: AWS CLI v2 with SSO / `aws login` access to the target account

> **Corporate network / TLS inspection**: if npm fails with `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`,
> make Node trust the Windows certificate store instead of disabling TLS checks:
> `setx NODE_USE_SYSTEM_CA 1` (then open a new terminal).

## Run locally

```bash
pnpm install
cp apps/api/.env.example apps/api/.env     # then set JWT_SECRET (see comment in file)
pnpm dev                                   # API on :3000, web on http://localhost:5173
```

By default `DB_DRIVER=memory` (no Docker needed; users are lost on restart). To use DynamoDB Local:

```bash
pnpm db:local        # docker compose up DynamoDB Local on :8000
pnpm db:init         # create the users table
# in apps/api/.env: DB_DRIVER=dynamodb
```

### Enable Google sign-in (optional)

1. Google Cloud Console → APIs & Services → Credentials → **Create OAuth client ID** → *Web application*.
2. Authorized redirect URIs: `http://localhost:5173/api/auth/google/callback`
   (and, after deploying, the `GoogleRedirectUri` stack output).
3. Put the client ID and secret into `apps/api/.env` (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`) and restart the API.

## API

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/health` | – | ALB health check |
| GET | `/api/auth/providers` | – | `{ local: true, google: boolean }` |
| POST | `/api/auth/register` | – | `{ email, password, name }` → user + session cookie |
| POST | `/api/auth/login` | – | `{ email, password }` → user + session cookie |
| POST | `/api/auth/logout` | – | clears the cookie (204) |
| GET | `/api/auth/me` | cookie or Bearer | current user |
| GET | `/api/auth/google` | – | redirect to Google (404 when not configured) |
| GET | `/api/auth/google/callback` | – | sets the cookie, redirects to `/` (or `/login?error=google`) |

Protect your own endpoints with `@UseGuards(JwtAuthGuard)` and read the user with `@CurrentUser()`.

## Quality gates

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm synth            # builds web, then cdk synth (fails on unacknowledged cdk-nag errors)
```

## Deploy to AWS

Deploys to UAT/prod go through the pipeline. From a laptop, only deploy **dev** in a sandbox account.

```bash
aws login                                   # or: aws sso login --profile <profile>
cd infra && pnpm exec cdk bootstrap         # once per account/region
```

Optional Google login: store the OAuth client in Secrets Manager (never in code or CDK context):

```bash
aws secretsmanager create-secret --name aws-start-poc/dev/google-oauth \
  --secret-string '{"clientId":"<id>","clientSecret":"<secret>"}'
```

Deploy (Docker must be running to build the API image):

```bash
pnpm --filter web build
pnpm --filter infra exec cdk deploy -c env=dev -c googleSecretName=aws-start-poc/dev/google-oauth
```

Stack outputs:

- `AppUrl`: open in the browser
- `GoogleRedirectUri`: add to the Google OAuth client's authorized redirect URIs

### CDK context

| Key | Default | Purpose |
|---|---|---|
| `env` | `dev` | `dev` / `uat` / `prod`. Prod: 2+ tasks, 2 NAT gateways, RETAIN data, deletion protection |
| `googleSecretName` | – | Secrets Manager secret `{clientId, clientSecret}`; enables Google login |
| `albCertificateArn` + `apiOriginDomain` | – | HTTPS from CloudFront to ALB (recommended beyond POC) |
| `tags` | see `cdk.json` | `Project`, `Owner`, `CostCenter` (+ `Environment`) on every resource |

### CI/CD (GitHub Actions)

`.github/workflows/ci.yml` runs all gates on every PR. On `main` it deploys **dev** when repo variable
`AWS_DEPLOY_ROLE_ARN` (GitHub OIDC role) is set. Optional variables: `AWS_REGION`, `GOOGLE_SECRET_NAME`.

## Production hardening (before going beyond POC)

cdk-nag findings acknowledged for the POC (see `addNagSuppressions` in `infra/lib/poc-stack.ts`):

- [ ] Custom domain + ACM certificate on CloudFront; set `albCertificateArn`/`apiOriginDomain` for TLS to the ALB
- [ ] AWS WAF on CloudFront (rate-based + AWS managed rules)
- [ ] Access logs for ALB, CloudFront and S3
- [ ] Secret rotation (JWT signing key, origin-verify header)
- [ ] Scope the web KMS key policy to the distribution ID after first deploy (CDK warning on synth)
- [ ] Refresh tokens / shorter access-token lifetime; account lockout and email verification for local sign-up
- [ ] Distributed rate limiting (current throttler is per task, in memory)
- [ ] CloudWatch alarms (5xx, unhealthy hosts, DynamoDB throttles) and X-Ray / ADOT tracing

## Deviations from the WGCL standard stack

This POC uses **NestJS** (standard: FastAPI) and **React** (standard: Nuxt; React needs Tech Lead approval),
and app-managed accounts (standard: Amazon Cognito federated with Entra ID). Get Tech Lead sign-off before
production use. Moving identity to Cognito later only touches `apps/api/src/auth` and the web `useAuth` hooks.
