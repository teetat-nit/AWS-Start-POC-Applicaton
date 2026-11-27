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
Browser โ”€โ”€โ–บ CloudFront โ”€โ”ฌโ”€ /*      โ”€โ”€โ–บ S3 (React build, private, OAC + KMS)
                        โ””โ”€ /api/*  โ”€โ”€โ–บ ALB โ”€โ”€โ–บ ECS Fargate (NestJS) โ”€โ”€โ–บ DynamoDB
                                         โ–ฒ only accepts requests carrying CloudFront's secret header
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

- Node.js 26 LTS (`.nvmrc`) and pnpm 12: `npm i -g pnpm@12` (or `npx pnpm@12 โ€ฆ`)
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

1. Google Cloud Console โ’ APIs & Services โ’ Credentials โ’ **Create OAuth client ID** โ’ *Web application*.
2. Authorized redirect URIs: `http://localhost:5173/api/auth/google/callback`
   (and, after deploying, the `GoogleRedirectUri` stack output).
3. Put the client ID and secret into `apps/api/.env` (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`) and restart the API.

## API

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/health` | โ€“ | ALB health check |
| GET | `/api/auth/providers` | โ€“ | `{ local: true, google: boolean }` |
| POST | `/api/auth/register` | โ€“ | `{ email, password, name }` โ’ user + session cookie |
| POST | `/api/auth/login` | โ€“ | `{ email, password }` โ’ user + session cookie |
| POST | `/api/auth/logout` | โ€“ | clears the cookie (204) |
| GET | `/api/auth/me` | cookie or Bearer | current user |
| GET | `/api/auth/google` | โ€“ | redirect to Google (404 when not configured) |
| GET | `/api/auth/google/callback` | โ€“ | sets the cookie, redirects to `/` (or `/login?error=google`) |

Protect your own endpoints with `@UseGuards(JwtAuthGuard)` and read the user with `@CurrentUser()`.

## Quality gates

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm synth            # builds web, then cdk synth (fails on unacknowledged cdk-nag errors)
```

## Deploy to AWS

Project name in AWS: **happy-path** (`projectName` in `infra/cdk.json`). Stacks:

| Stack | Deployed by | Contents |
|---|---|---|
| `happy-path-github-oidc` | you, once per account, from a laptop | GitHub OIDC provider + role `happy-path-github-deploy` |
| `happy-path-dev` | GitHub Actions on every push to `main` | the application (VPC, DynamoDB, ECS, ALB, S3, CloudFront) |

Deploys to UAT/prod go through the pipeline. From a laptop, only the one-time setup and **dev** in a sandbox account.

### One-time setup (laptop, `aws login`)

```powershell
winget install Amazon.AWSCLI                 # AWS CLI v2, then open a new terminal
aws login                                    # sign in with your console credentials; pick the region ap-southeast-2 (ap-southeast-1 is blocked by an org SCP)
aws sts get-caller-identity                  # check the account is the right one
cd infra
pnpm exec cdk bootstrap                      # once per account/region
pnpm exec cdk deploy happy-path-github-oidc  # prints output DeployRoleArn
```

If the account already has a GitHub OIDC provider (`IAM โ’ Identity providers โ’
token.actions.githubusercontent.com`), put its ARN in `githubOidcProviderArn` in `cdk.json` first. Only one is allowed per account.

Then in GitHub โ’ repo **Settings**:

1. **Environments** โ’ *New environment* `dev` (optionally add required reviewers or restrict to branch `main`).
2. **Secrets and variables โ’ Actions โ’ Variables**:
   - `AWS_DEPLOY_ROLE_ARN` = the `DeployRoleArn` output (`arn:aws:iam::<account>:role/happy-path-github-deploy`)
   - `AWS_REGION` = the region you bootstrapped (`ap-southeast-2`)
   - `GOOGLE_SECRET_NAME` (optional) = `happy-path/dev/google-oauth`

Push to `main` (or *Actions โ’ ci โ’ Run workflow*). The `deploy-dev` job deploys `happy-path-dev`, and the app URL is shown on the run summary.

The deploy role can only assume the CDK bootstrap roles, and only from this repo's `dev` environment. No AWS keys are stored in GitHub.

### Temporary: dev without CloudFront (`hosting=alb`)

New AWS accounts can be blocked from creating CloudFront distributions ("Your account must be verified…").
Until AWS Support verifies the account, dev can run without CloudFront and S3:

```
Browser ──HTTP──► ALB ──► ECS Fargate (NestJS serves /api/* and the React build) ──► DynamoDB
```

- Turn on: GitHub repo variable `HOSTING=alb` (or `-c hosting=alb` locally). It is refused for uat/prod.
- Limits: plain HTTP, so use test accounts and test passwords only. No CloudFront security headers or edge cache.
  Google login does not work, because Google needs an https redirect URI.
- Turn off: delete the `HOSTING` variable and re-run the workflow. CloudFront + S3 come back, and the app URL changes to `https://…cloudfront.net`.
### Optional: Google login in AWS

Store the OAuth client in Secrets Manager (never in code or CDK context):

```bash
aws secretsmanager create-secret --name happy-path/dev/google-oauth \
  --secret-string '{"clientId":"<id>","clientSecret":"<secret>"}'
```

### Manual deploy of dev (laptop, Docker must be running to build the API image)

```bash
pnpm --filter web build
pnpm --filter infra exec cdk deploy happy-path-dev -c env=dev -c googleSecretName=happy-path/dev/google-oauth
```

Stack outputs:

- `AppUrl`: open in the browser
- `GoogleRedirectUri`: add to the Google OAuth client's authorized redirect URIs

### CDK context

| Key | Default | Purpose |
|---|---|---|
| `projectName` | `happy-path` | Stack names, role name, `Project` tag |
| `env` | `dev` | `dev` / `uat` / `prod`. Prod: 2+ tasks, 2 NAT gateways, RETAIN data, deletion protection |
| `githubRepo` | `teetat-nit/AWS-Start-POC-Applicaton` | Repo allowed to deploy (enables the `-github-oidc` stack) |
| `githubEnvironments` | `dev` | Comma-separated GitHub environments trusted by the deploy role |
| `githubOidcProviderArn` | โ€“ | Reuse an existing GitHub OIDC provider instead of creating one |
| `googleSecretName` | โ€“ | Secrets Manager secret `{clientId, clientSecret}`; enables Google login |
| `albCertificateArn` + `apiOriginDomain` | โ€“ | HTTPS from CloudFront to ALB (recommended beyond POC) |
| `tags` | see `cdk.json` | `Project`, `Owner`, `CostCenter` (+ `Environment`) on every resource |

### CI/CD (GitHub Actions)

`.github/workflows/ci.yml` runs all gates on every PR. On `main` it deploys `happy-path-dev` when repo variable
`AWS_DEPLOY_ROLE_ARN` is set (see the one-time setup above). Optional variables: `AWS_REGION`, `GOOGLE_SECRET_NAME`.

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
