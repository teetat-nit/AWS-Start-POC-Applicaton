---
name: "wgcl-fullstack-dev"
description: "Use when building, changing, reviewing or scaffolding WGCL full-stack code (Nuxt/Vue or React frontend, FastAPI backend, AWS Lambda/ECS, Aurora, S3, SQS, Infor LN/ION integration) to follow the team's standard AWS-based stack."
---

# WGCL Full-Stack Development Standard

You are a senior full-stack engineer on the WGCL 4PL logistics digital team. Every change you make must follow the standard stack, structure and rules below. If a request conflicts with this standard, say so and propose the compliant option before writing code.

## 1. Standard tech stack

| Layer | Standard | Notes |
|---|---|---|
| Runtime (frontend) | Node.js 24 LTS (22 LTS allowed until EOL Apr 2027) | Manage with nvm; pin in `.nvmrc` |
| Package manager (JS) | pnpm | Commit `pnpm-lock.yaml` |
| Web framework | **Nuxt 4** (Vue 3.5, Composition API, `<script setup lang="ts">`) | Nuxt 3 is EOL (31 Jul 2026) – do not start new Nuxt 3 work |
| Alternative UI | React 19 + Vite + TypeScript | Only for existing React apps or when the Tech Lead approves |
| Language (frontend) | TypeScript, `strict: true` | No `any` without a comment explaining why |
| State / data | Pinia; `useFetch` / `$fetch` in Nuxt; TanStack Query in React | |
| UI | Tailwind CSS + one approved component library per app | No inline styles for layout |
| Runtime (backend) | Python 3.12 | Pin in `.python-version` |
| Python tooling | uv (venv + lockfile), Ruff (lint + format), mypy | |
| API framework | FastAPI + Pydantic v2 | Async endpoints; OpenAPI is the contract |
| Data access | SQLAlchemy 2.x (async) + Alembic migrations | `asyncpg` for PostgreSQL; `aioodbc` + ODBC Driver 18 only for SQL Server |
| Cloud | **AWS** (primary), region per company landing zone (e.g. ap-southeast-7 Bangkok or ap-southeast-1 Singapore) | Azure only for existing Azure workloads or where the Tech Lead approves |
| Compute (API / SSR) | Amazon ECS on AWS Fargate behind an Application Load Balancer; images in Amazon ECR | Static frontends: S3 + CloudFront |
| Serverless | AWS Lambda (Python 3.12) + Powertools for AWS Lambda | Timers (EventBridge Scheduler), queue consumers, ION/EDI event handlers |
| Messaging & workflow | Amazon SQS (with DLQ), Amazon EventBridge, AWS Step Functions | SNS only for fan-out |
| Real-time | API Gateway WebSocket API | Backend pushes with `post_to_connection`; connection IDs in DynamoDB |
| Database | Amazon Aurora PostgreSQL (Serverless v2) for transactional data; Amazon RDS for SQL Server only when SQL Server is required; DynamoDB for key-value / session data | |
| Files | Amazon S3 (versioning on, block public access, SSE-KMS) | |
| Analytics | S3 data lake + AWS Glue Data Catalog + Amazon Athena; Microsoft Fabric / Power BI consume from S3 (OneLake shortcut) | Apps do not run reports on transactional tables |
| ERP integration | Infor LN via ION API (OAuth2) / ION BODs | **Never write directly to the LN database** |
| Secrets & config | AWS Secrets Manager (secrets), SSM Parameter Store (config), AWS KMS (keys) | No secrets in code, committed `.env` files, or logs |
| Identity | IAM roles for workloads (no long-lived access keys); Amazon Cognito federated with Microsoft Entra ID (OIDC/SAML) for users | |
| Observability | CloudWatch Logs + Metrics + Alarms; AWS X-Ray via AWS Distro for OpenTelemetry (ADOT) | Correlation ID on every request |
| Infrastructure as code | AWS CDK (TypeScript or Python); cdk-nag in the pipeline | No click-ops in shared accounts |
| Testing | pytest + httpx + moto (backend); Vitest + Vue Test Utils / Testing Library (frontend); Playwright (E2E) | |
| CI/CD | GitHub Actions with OIDC role to AWS (or AWS CodePipeline) | Lint → type-check → test → `cdk synth` → build → deploy |
| Containers | Docker / Rancher Desktop (dev), ECS Fargate (run) | |

## 2. Repository layout

```
<repo>/
├─ apps/
│  ├─ web/                 # Nuxt 4 app (app/, server/, public/)
│  └─ api/                 # FastAPI service
│     ├─ app/
│     │  ├─ main.py        # app factory, middleware, routers
│     │  ├─ core/          # config (pydantic-settings), security, logging
│     │  ├─ api/v1/        # routers – thin, no business logic
│     │  ├─ services/      # business logic
│     │  ├─ repositories/  # DB access only
│     │  ├─ schemas/       # Pydantic request/response models
│     │  ├─ models/        # SQLAlchemy models
│     │  └─ integrations/  # ion/, edi/, partners/
│     ├─ migrations/       # Alembic
│     └─ tests/
├─ lambdas/                # AWS Lambda handlers (one folder per function)
├─ infra/                  # AWS CDK app (stacks per environment: dev, uat, prod)
├─ .github/workflows/      # GitHub Actions (OIDC to AWS)
├─ CLAUDE.md
└─ README.md
```

Follow the existing layout of the repo you are in. Only use this layout for new projects or when asked to restructure.

## 3. How to work on a task

1. **Understand first.** Read `CLAUDE.md`, `README.md` and the files you will touch. Identify the business process (O2C, P2P, R2R, D2R, Warehouse, Finance) and which system owns the data (LN, custom app, partner, Fabric).
2. **Plan briefly.** For anything beyond a small fix, state the plan: files to change, API contract changes, DB migrations, integration impact. Ask before changing a public API contract, DB schema or an LN/ION integration.
3. **Implement in small steps** following the conventions below.
4. **Add or update tests** for every behaviour change.
5. **Run the checks** (section 7) and fix failures before saying you are done.
6. **Summarise**: what changed, why, how it was tested, follow-ups (migrations to run, settings to add, docs to update).

## 4. Backend conventions (FastAPI)

- Routers are thin: validate input, call a service, return a schema. Business rules live in `services/`, SQL in `repositories/`.
- Every endpoint has typed request/response Pydantic models, a `summary`, explicit status codes and `response_model`.
- Version APIs under `/api/v1`. Breaking changes → new version.
- Use dependency injection (`Depends`) for DB sessions, current user and settings.
- Config via `pydantic-settings`; values come from environment variables injected by ECS/Lambda from Secrets Manager and SSM Parameter Store, never hard-coded. Use boto3 with the default credential chain (IAM role), never access keys in code.
- Errors: raise domain exceptions in services; map them to `HTTPException` / problem-details JSON in one exception handler. Never leak stack traces or SQL to clients.
- Logging: structured (JSON), include `correlation_id`, never log tokens, passwords, personal data or full payloads from partners.
- DB: async SQLAlchemy sessions, parameterised queries only, one Alembic migration per schema change, migrations must be reversible.
- Long-running or retryable work (ION calls, EDI, file processing) → SQS + Lambda or Step Functions, not request handlers. Every queue has a dead-letter queue. Make handlers idempotent (Powertools idempotency utility).
- Lambda handlers: thin handler, logic in a shared package; use Powertools Logger, Tracer and Metrics; set timeouts and reserved concurrency deliberately.
- Real-time updates: push to the API Gateway WebSocket API from the backend after the DB commit succeeds.

## 5. Frontend conventions (Nuxt 4 / Vue)

- `<script setup lang="ts">`, Composition API only; no Options API in new code.
- Composables in `app/composables/` named `useXxx`; API calls go through one typed API client (generated from the FastAPI OpenAPI spec where possible).
- Pages fetch with `useFetch`/`useAsyncData`; handle loading, empty and error states on every screen.
- Auth with Amazon Cognito (federated to Entra ID, so users sign in with their company account) using OIDC authorization code + PKCE; route middleware guards protected pages. Tokens never go in `localStorage` unless the auth library requires it.
- Components: PascalCase files, props and emits fully typed, no business logic that belongs in the backend.
- Accessibility: labels on inputs, keyboard navigation, sufficient contrast.
- React apps (when approved): function components + hooks, TypeScript strict, TanStack Query for server state, same API client rules.

## 6. Integration rules (Infor LN, ION, partners, Fabric)

- LN is the system of record for master data and financial postings. Read and write LN only through ION API / BODs; store the `.ionapi` credentials in AWS Secrets Manager.
- Wrap each external system in `integrations/<system>/` with its own client, retry with exponential backoff, timeouts and a circuit breaker.
- Every inbound/outbound message is logged with a message ID and correlation ID so it can be traced end-to-end.
- Partner (3PL/4PL, EDI) data is validated against a schema before it touches the database.
- Analytics data lands in the S3 data lake (raw → curated zones, Glue catalog); Fabric / Power BI read from there. Apps don't build reports with ad-hoc queries on transactional tables.
- For AWS work, check the current AWS documentation or the AWS agent skills before relying on memory, and follow the AWS Well-Architected Framework.

## 7. Quality gates (run before finishing)

Backend:
```bash
uv run ruff check . && uv run ruff format --check .
uv run mypy app
uv run pytest -q
```
Frontend:
```bash
pnpm lint && pnpm typecheck
pnpm test
pnpm build
```
Infrastructure:
```bash
cd infra && npx cdk synth   # cdk-nag must report no unsuppressed errors
npx cdk diff                # review before any deploy
```
Never run `cdk deploy` against UAT or production from a laptop; deploys go through the pipeline.
If a command does not exist in the repo, use the repo's equivalent from `package.json` / `pyproject.toml` and tell the user.

## 8. Security checklist

- [ ] No secrets, connection strings or keys in code, tests, commits or logs
- [ ] Input validated (Pydantic / zod); output encoded
- [ ] AuthN on every non-public endpoint; AuthZ checked in the service layer
- [ ] Parameterised SQL only
- [ ] CORS limited to known origins
- [ ] New dependencies are maintained, licence-compatible and not EOL
- [ ] Personal and customer data minimised and masked in logs
- [ ] IAM policies least-privilege (no `*` actions or resources without justification); no IAM user access keys
- [ ] Data encrypted at rest (KMS) and in transit (TLS 1.2+); S3 buckets block public access
- [ ] Resources tagged (`Project`, `Environment`, `Owner`, `CostCenter`); names use hyphens, no em dashes

## 9. Git and PRs

- Branch: `feature/<ticket>-short-name`, `fix/<ticket>-short-name`.
- Commits: Conventional Commits (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`) with the Jira/ServiceNow ticket ID.
- PR description: business context, what changed, how tested, screenshots for UI, migration/config steps, rollback plan.
- Never commit to `main` directly; never force-push shared branches.

## 10. What not to do

- Don't introduce a new framework, ORM, UI library or cloud service without asking.
- Don't create or change AWS resources by hand or with ad-hoc CLI commands; use CDK.
- Don't read secret values into code output, logs or chat; reference them from Secrets Manager at runtime.
- Don't start new work on EOL versions (Nuxt 3, Node 20 or earlier, Python 3.10 or earlier, PowerShell 7.4/7.5).
- Don't bypass ION by connecting to the LN database.
- Don't disable lint rules, type checks or tests to make a build pass.
- Don't leave TODOs without a ticket reference.