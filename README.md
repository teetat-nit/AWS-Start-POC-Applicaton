# Happy Path: React + NestJS + DynamoDB on AWS

A quick-start full-stack app with sign-up and sign-in, deployed to AWS by GitHub Actions.
The AWS project name is **happy-path**.

| Layer | Tech |
|---|---|
| Frontend | React 19, Vite 8, TypeScript, Tailwind CSS 4, TanStack Query, React Router 8 |
| Backend | NestJS 12 (Node.js 26 LTS), Passport (JWT + Google OAuth2), argon2id password hashing |
| Database | Amazon DynamoDB (serverless, on-demand) |
| Hosting | CloudFront + S3 (SPA), ALB + ECS Fargate (API), Secrets Manager |
| IaC / CI | AWS CDK (TypeScript) with cdk-nag, GitHub Actions (OIDC to AWS) |

```
Browser --> CloudFront --+-- /*      --> S3 (React build, private, OAC + KMS)
                         +-- /api/*  --> ALB --> ECS Fargate (NestJS) --> DynamoDB
                                          ^ only accepts requests carrying CloudFront's secret header
```

The SPA and the API share one origin (the Vite proxy locally, CloudFront in AWS). The session is an
**httpOnly, SameSite=Lax cookie**, so no tokens are kept in `localStorage` and no CORS is needed.

Diagrams, request flows, the data model and the security controls are in
**[docs/architecture.md](docs/architecture.md)**.

> **Current state of dev:** the AWS account cannot create CloudFront distributions until AWS Support
> verifies it, so dev runs in the temporary `hosting=alb` mode (plain HTTP, no CloudFront).
> See [Temporary: dev without CloudFront](#temporary-dev-without-cloudfront-hostingalb).

## Features

- Local accounts: register, sign in and sign out with email and password (argon2id, OWASP parameters)
- Optional **Sign in with Google** (OAuth2 / OpenID Connect). It switches on when credentials are configured,
  and the button appears automatically
  - Links to an existing account when the Google email is verified and matches
  - CSRF-protected `state` stored in a short-lived httpOnly cookie
- Unique emails enforced in DynamoDB with conditional transactional writes (no GSI needed)
- Rate limiting on credential endpoints, input validation (unknown fields rejected), Helmet headers
- Correlation ID on every request (`x-correlation-id`), JSON logs in AWS
- Protected routes in the SPA, loading and error states

## Repository layout

```
apps/
  api/              NestJS API
    src/auth/         controller, service, JWT + Google strategies, OAuth state store
    src/users/        User entity, repository port, DynamoDB + in-memory implementations
    src/config/       env validation (fails fast on bad config)
    src/web-hosting.ts  serves the SPA from the API (hosting=alb only)
    scripts/          create-local-table.ts (DynamoDB Local)
    Dockerfile        production image: API + built SPA (build context = repo root)
  web/              React SPA (src/pages, src/hooks/useAuth.ts, src/lib/api.ts)
infra/              CDK app: app stack per environment + one-time GitHub OIDC stack
docs/               architecture.md (diagrams)
.github/workflows/  CI: lint, typecheck, test, build, cdk synth; deploy dev on main
docker-compose.yml  DynamoDB Local
```

## Prerequisites

- Node.js 26 LTS (`.nvmrc`) and pnpm 12: `npm i -g pnpm@12` (or `npx pnpm@12 ...`)
- Optional: Docker or Rancher Desktop (DynamoDB Local; also needed for a manual `cdk deploy` of the app stack)
- For deploys: AWS CLI v2 with `aws login` (or SSO) access to the target account

> **Corporate network / TLS inspection (Zscaler):** tools that ship their own certificate list fail with
> `unable to get local issuer certificate`. Never disable TLS checks; trust the corporate root instead:
>
> | Tool | Fix |
> |---|---|
> | Node, npm, pnpm, CDK | `setx NODE_USE_SYSTEM_CA 1` (uses the Windows certificate store) |
> | git | `git config --global http.sslBackend schannel` |
> | AWS CLI v2 | `setx AWS_CA_BUNDLE %USERPROFILE%\.aws\ca-bundle.pem`. The bundle is the CLI's own `cacert.pem` plus the Zscaler root CA |
>
> Open a new terminal after `setx`.

## Run locally

```bash
pnpm install
cp apps/api/.env.example apps/api/.env     # then set JWT_SECRET (see the comment in the file)
pnpm dev                                   # API on :3000, web on http://localhost:5173
```

By default `DB_DRIVER=memory` (no Docker needed; users are lost on restart). To use DynamoDB Local:

```bash
pnpm db:local        # docker compose up DynamoDB Local on :8000
pnpm db:init         # create the users table
# in apps/api/.env: DB_DRIVER=dynamodb
```

If `pnpm dev` fails with `EADDRINUSE`, an old dev server is still running:
`netstat -ano | findstr :3000`, then `taskkill /PID <pid> /T /F`.

### Enable Google sign-in (optional)

1. Google Cloud Console → APIs & Services → Credentials → **Create OAuth client ID** → *Web application*.
2. Authorized redirect URIs: `http://localhost:5173/api/auth/google/callback`
   (and, after deploying with CloudFront, the `GoogleRedirectUri` stack output).
3. Put the client ID and secret into `apps/api/.env` (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`) and restart the API.

## API

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/health` | none | ALB health check |
| GET | `/api/auth/providers` | none | `{ local: true, google: boolean }` |
| POST | `/api/auth/register` | none | `{ email, password, name }` → user + session cookie |
| POST | `/api/auth/login` | none | `{ email, password }` → user + session cookie |
| POST | `/api/auth/logout` | none | clears the cookie (204) |
| GET | `/api/auth/me` | cookie or Bearer | current user |
| GET | `/api/auth/google` | none | redirect to Google (404 when not configured) |
| GET | `/api/auth/google/callback` | none | sets the cookie, redirects to `/` (or `/login?error=google`) |

Protect your own endpoints with `@UseGuards(JwtAuthGuard)` and read the user with `@CurrentUser()`.

## Quality gates

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm synth            # builds web, then cdk synth (fails on unacknowledged cdk-nag errors)
```

## Deploy to AWS

Region: **ap-southeast-2** (Sydney). An organization SCP blocks CloudFormation in ap-southeast-1.

| Stack | Deployed by | Contents |
|---|---|---|
| `happy-path-github-oidc` | you, once per account, from a laptop | GitHub OIDC provider + role `happy-path-github-deploy` |
| `happy-path-dev` | GitHub Actions on every push to `main` | the application (VPC, DynamoDB, ECS, ALB, and CloudFront + S3 unless `hosting=alb`) |

Deploys to UAT and prod go through the pipeline. From a laptop, only run the one-time setup and **dev** in a sandbox account.

### One-time setup (laptop, `aws login`)

```powershell
winget install Amazon.AWSCLI                 # AWS CLI v2, then open a new terminal
aws login                                    # sign in with your console credentials; choose ap-southeast-2
aws sts get-caller-identity                  # check that the account is the right one
cd infra
pnpm exec cdk bootstrap                      # once per account/region
pnpm exec cdk deploy happy-path-github-oidc  # prints the output DeployRoleArn
```

Before deploying, check two values in `infra/cdk.json`:

- `githubSubjectPrefix`: the start of the GitHub OIDC token's `sub` claim. This repo uses GitHub's
  immutable subject format (`repo:<owner>@<id>/<repo>@<id>`). Look it up with
  `gh api repos/<owner>/<repo>/actions/oidc/customization/sub` (field `sub_claim_prefix`).
  If this is wrong, the deploy job fails with `Not authorized to perform sts:AssumeRoleWithWebIdentity`.
- `githubOidcProviderArn`: set it if the account already has a GitHub OIDC provider
  (IAM → Identity providers → `token.actions.githubusercontent.com`). Only one is allowed per account.

Then, in GitHub → repo **Settings** (or with the `gh` CLI):

1. **Environments** → *New environment* `dev`, with deployment branches restricted to `main`.
2. **Secrets and variables → Actions → Variables**:
   - `AWS_DEPLOY_ROLE_ARN` = the `DeployRoleArn` output (`arn:aws:iam::<account>:role/happy-path-github-deploy`)
   - `AWS_REGION` = `ap-southeast-2`
   - `HOSTING` (optional) = `alb`, see below
   - `GOOGLE_SECRET_NAME` (optional) = `happy-path/dev/google-oauth`

Push to `main` (or *Actions → ci → Run workflow*). The `deploy-dev` job deploys `happy-path-dev`, and the app URL
is shown on the run summary.

The deploy role can only assume the CDK bootstrap roles, and only from this repo's `dev` environment.
No AWS keys are stored in GitHub.

### Temporary: dev without CloudFront (`hosting=alb`)

New AWS accounts can be blocked from creating CloudFront distributions ("Your account must be verified
before you can add new CloudFront resources"). Until AWS Support verifies the account, dev can run without
CloudFront and S3:

```
Browser --HTTP--> ALB --> ECS Fargate (NestJS serves /api/* and the React build) --> DynamoDB
```

- **Turn on:** set the GitHub repo variable `HOSTING=alb` (or pass `-c hosting=alb` locally). It is refused for uat and prod.
- **Limits:** plain HTTP, so use test accounts and test passwords only. There are no CloudFront security headers or edge cache.
  Google login does not work, because Google needs an https redirect URI.
- **Turn off:** delete the `HOSTING` variable and re-run the workflow. CloudFront and S3 come back, and the app URL
  changes to `https://<id>.cloudfront.net`.

### Optional: Google login in AWS

Store the OAuth client in Secrets Manager (never in code or CDK context):

```bash
aws secretsmanager create-secret --name happy-path/dev/google-oauth \
  --secret-string '{"clientId":"<id>","clientSecret":"<secret>"}'
```

### Manual deploy of dev (laptop; Docker must be running to build the image)

```bash
pnpm --filter web build
pnpm --filter infra exec cdk deploy happy-path-dev -c env=dev -c googleSecretName=happy-path/dev/google-oauth
```

Stack outputs:

- `AppUrl`: open it in the browser
- `GoogleRedirectUri`: add it to the Google OAuth client's authorized redirect URIs
- `AlbDnsName`, `UsersTableName`: for troubleshooting

To stop paying for dev when it is not in use: `cd infra; pnpm exec cdk destroy happy-path-dev`
(the next push to `main` recreates it, with an empty users table).

### CDK context

| Key | Default | Purpose |
|---|---|---|
| `projectName` | `happy-path` | Stack names, role name, `Project` tag |
| `env` | `dev` | `dev` / `uat` / `prod`. Prod: 2+ tasks, 2 NAT gateways, RETAIN data, deletion protection |
| `hosting` | `cloudfront` | `alb` = temporary dev-only mode without CloudFront (see above) |
| `githubRepo` | `teetat-nit/AWS-Start-POC-Applicaton` | Repo allowed to deploy (enables the `-github-oidc` stack) |
| `githubSubjectPrefix` | `repo:<githubRepo>` | Start of the OIDC `sub` claim (immutable subject format, see above) |
| `githubEnvironments` | `dev` | Comma-separated GitHub environments trusted by the deploy role |
| `githubOidcProviderArn` | none | Reuse an existing GitHub OIDC provider instead of creating one |
| `googleSecretName` | none | Secrets Manager secret `{clientId, clientSecret}`; enables Google login |
| `albCertificateArn` + `apiOriginDomain` | none | HTTPS from CloudFront to the ALB (recommended beyond the POC) |
| `tags` | see `cdk.json` | `Owner`, `CostCenter` (+ `Project`, `Environment`) on every resource |

### CI/CD (GitHub Actions)

`.github/workflows/ci.yml` runs all gates on every PR. On `main` it deploys `happy-path-dev` when the repo variable
`AWS_DEPLOY_ROLE_ARN` is set (see the one-time setup above). Optional variables: `AWS_REGION`, `HOSTING`,
`GOOGLE_SECRET_NAME`.

## Production hardening (before going beyond the POC)

cdk-nag findings acknowledged for the POC (see `addNagSuppressions` in `infra/lib/poc-stack.ts`):

- [ ] Ask AWS Support to verify the account for CloudFront, then remove the `HOSTING=alb` variable
- [ ] Custom domain + ACM certificate on CloudFront; set `albCertificateArn`/`apiOriginDomain` for TLS to the ALB
- [ ] AWS WAF on CloudFront (rate-based + AWS managed rules)
- [ ] Access logs for ALB, CloudFront and S3
- [ ] Secret rotation (JWT signing key, origin-verify header)
- [ ] Scope the web KMS key policy to the distribution ID after the first deploy (CDK warning on synth)
- [ ] Refresh tokens / shorter access-token lifetime; account lockout and email verification for local sign-up
- [ ] Distributed rate limiting (the current throttler is per task, in memory)
- [ ] CloudWatch alarms (5xx, unhealthy hosts, DynamoDB throttles) and X-Ray / ADOT tracing

## Deviations from the WGCL standard stack

This POC uses **NestJS** (standard: FastAPI) and **React** (standard: Nuxt; React needs Tech Lead approval),
and app-managed accounts (standard: Amazon Cognito federated with Entra ID). Get Tech Lead sign-off before
production use. Moving identity to Cognito later only touches `apps/api/src/auth` and the web `useAuth` hooks.
