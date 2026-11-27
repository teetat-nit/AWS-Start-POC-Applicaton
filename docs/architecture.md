# Happy Path: Cloud Architecture

This document describes how the Happy Path application (this repository) runs on AWS: the infrastructure,
how requests flow, how code gets deployed, and which security controls are in place. Everything here is
defined in code. The source of truth is [`infra/lib/poc-stack.ts`](../infra/lib/poc-stack.ts),
[`infra/lib/github-oidc-stack.ts`](../infra/lib/github-oidc-stack.ts) and
[`.github/workflows/ci.yml`](../.github/workflows/ci.yml).

The diagrams use Mermaid and render on GitHub and in VS Code (with a Mermaid preview extension).

| | |
|---|---|
| AWS project name | `happy-path` |
| Region | `ap-southeast-2` (Sydney) |
| Environments | `dev` (deployed), `uat` and `prod` (defined in code, not deployed yet) |
| Stacks | `happy-path-<env>` (application), `happy-path-github-oidc` (CI access, one per account) |
| Hosting modes | `cloudfront` (target design), `alb` (temporary, dev only, used today) |

---

## 1. System overview

```mermaid
flowchart LR
    user(["User<br/>web browser"])
    google["Google<br/>OAuth 2.0 / OIDC<br/>(optional)"]
    dev(["Developer"])
    gh["GitHub<br/>repo + Actions"]

    subgraph aws["AWS account · ap-southeast-2"]
        app["Happy Path<br/>React SPA + NestJS API"]
        db[("DynamoDB<br/>users table")]
    end

    user -- "HTTPS: pages and /api/*" --> app
    user -. "Sign in with Google" .-> google
    google -. "redirect with auth code" .-> app
    app -- "verify code, read profile" --> google
    app -- "read / write users" --> db
    dev -- "git push" --> gh
    gh -- "OIDC role, cdk deploy" --> aws
```

The browser loads the React single-page app (SPA) and calls the API under `/api/*` on the **same origin**.
The session is an httpOnly cookie that holds a signed JWT, so the SPA never handles tokens and no CORS is needed.

---

## 2. AWS architecture: target design (`hosting=cloudfront`)

This is the intended design for all environments. It needs CloudFront to be enabled on the account
(see [section 3](#3-aws-architecture-current-dev-hostingalb) for today's dev setup).

```mermaid
flowchart TB
    user(["Browser"])

    subgraph edge["Edge (global)"]
        cf["CloudFront distribution<br/>HTTPS · security headers policy<br/>SPA rewrite function"]
    end

    subgraph region["AWS region ap-southeast-2"]
        s3[("S3 web bucket<br/>private · KMS · versioned<br/>Origin Access Control")]
        kms["KMS key<br/>(rotation on)"]

        subgraph vpc["VPC · 2 Availability Zones"]
            subgraph pub["Public subnets /24"]
                alb["Application Load Balancer<br/>:80, default 403<br/>forwards only with X-Origin-Verify"]
                nat["NAT gateway<br/>(1 in dev, 2 in prod)"]
            end
            subgraph priv["Private app subnets /22"]
                ecs["ECS Fargate service<br/>NestJS API · 0.5 vCPU / 1 GB<br/>read-only root FS<br/>dev 1-2 tasks · prod 2-6"]
            end
            gwe["DynamoDB<br/>gateway endpoint"]
        end

        ddb[("DynamoDB table<br/>on-demand · PITR")]
        sm["Secrets Manager<br/>JWT signing key<br/>origin-verify value<br/>Google OAuth client (optional)"]
        ecr["ECR<br/>(CDK bootstrap repo)<br/>API image"]
        cw["CloudWatch Logs<br/>API logs · VPC flow logs<br/>30 days"]
        deployfn["BucketDeployment<br/>Lambda (CDK)"]
    end

    user -- "HTTPS" --> cf
    cf -- "/* (cached)" --> s3
    cf -- "/api/* (not cached)<br/>+ X-Origin-Verify header" --> alb
    s3 -.- kms
    alb -- "HTTP :3000" --> ecs
    ecs -- "via gateway endpoint" --> gwe --> ddb
    ecs -. "read secrets at task start" .-> sm
    ecs -. "pull image via NAT" .-> ecr
    ecs -- "logs" --> cw
    ecs -- "outbound (Google APIs)" --> nat
    deployfn -- "upload SPA build,<br/>invalidate cache" --> s3
```

### How a request is routed

| Path | CloudFront behavior | Origin | Caching |
|---|---|---|---|
| `/*` | HTTP redirects to HTTPS. The SPA rewrite function sends paths without a file extension to `/index.html` | S3 via Origin Access Control | `CachingOptimized` |
| `/api/*` | HTTPS only; all methods; forwards cookies, query strings and headers except `Host` | ALB, with the secret `X-Origin-Verify` header added | Disabled |

The ALB is internet-facing because CloudFront needs to reach it, but its listener answers **403** to any
request without the correct `X-Origin-Verify` header. That value is generated in Secrets Manager and resolved
by CloudFormation at deploy time, so it never appears in the template or the code.

---

## 3. AWS architecture: current dev (`hosting=alb`)

The AWS account is not yet allowed to create CloudFront distributions ("Your account must be verified before
you can add new CloudFront resources"). Until AWS Support verifies the account, **dev** runs in a temporary
mode, switched on by the GitHub repository variable `HOSTING=alb`. The stack refuses this mode for uat and prod.

```mermaid
flowchart TB
    user(["Browser"])

    subgraph region["AWS region ap-southeast-2"]
        subgraph vpc["VPC · 2 Availability Zones"]
            subgraph pub["Public subnets"]
                alb["Application Load Balancer<br/>HTTP :80 → forward all"]
                nat["NAT gateway"]
            end
            subgraph priv["Private app subnets"]
                ecs["ECS Fargate service<br/>NestJS serves /api/*<br/>and the React build"]
            end
            gwe["DynamoDB gateway endpoint"]
        end
        ddb[("DynamoDB table")]
        sm["Secrets Manager<br/>JWT signing key"]
        ecr["ECR · API + SPA image"]
        cw["CloudWatch Logs"]
    end

    user -- "HTTP (not encrypted)" --> alb
    alb --> ecs
    ecs --> gwe --> ddb
    ecs -. "read secrets" .-> sm
    ecs -. "pull image via NAT" .-> ecr
    ecs --> cw
```

| | `hosting=cloudfront` (target) | `hosting=alb` (temporary) |
|---|---|---|
| Public URL | `https://<id>.cloudfront.net` | `http://<alb-dns-name>` |
| Who serves the SPA | S3 behind CloudFront | The API container ([`apps/api/src/web-hosting.ts`](../apps/api/src/web-hosting.ts)) |
| Transport | HTTPS from browser to CloudFront | **Plain HTTP**: use test accounts and test passwords only |
| ALB exposure | Only requests carrying the origin-verify header | All requests |
| Security headers | CloudFront `SECURITY_HEADERS` policy + Helmet | Helmet only (no HSTS, no upgrade-insecure-requests) |
| Session cookie | `Secure; HttpOnly; SameSite=Lax` | `HttpOnly; SameSite=Lax` (Secure would be dropped over HTTP) |
| Google sign-in | Works | Does not work (Google needs an https redirect URI) |
| Resources not created | none | CloudFront, S3 bucket, KMS key, origin-verify secret, BucketDeployment Lambda |

**To return to the target design:** delete the `HOSTING` variable in GitHub and re-run the workflow.

---

## 4. CI/CD and deployment

```mermaid
flowchart LR
    dev(["Developer"]) -- "push / PR" --> repo["GitHub repo<br/>main"]

    subgraph gha["GitHub Actions · ci.yml"]
        verify["verify job<br/>lint · typecheck · test<br/>build · cdk synth + cdk-nag"]
        deploy["deploy-dev job<br/>environment: dev<br/>(main branch only)"]
    end

    subgraph aws["AWS account"]
        oidc["IAM OIDC provider<br/>token.actions.githubusercontent.com"]
        role["IAM role<br/>happy-path-github-deploy<br/>(max 1 h session)"]
        boot["CDK bootstrap roles<br/>deploy · file-publishing<br/>image-publishing · lookup"]
        assets["Bootstrap S3 bucket + ECR<br/>(templates, image)"]
        cfn["CloudFormation<br/>stack happy-path-dev"]
    end

    repo --> verify --> deploy
    deploy -- "1. OIDC token<br/>(sub = repo + environment:dev)" --> oidc
    oidc -- "2. AssumeRoleWithWebIdentity" --> role
    role -- "3. sts:AssumeRole only" --> boot
    boot -- "4. publish assets" --> assets
    boot -- "5. create / update" --> cfn
```

| Step | What happens |
|---|---|
| Every PR and push | `verify` runs every quality gate. `cdk synth` fails on any cdk-nag (AwsSolutions) finding that has not been acknowledged with a reason |
| Push to `main` | `deploy-dev` gets a short-lived GitHub OIDC token. **No AWS keys are stored in GitHub** |
| Trust | The role trusts only tokens whose `sub` is this repo's `dev` environment (GitHub's immutable subject format, `githubSubjectPrefix` in `infra/cdk.json`) |
| Permissions | The role can only assume the CDK bootstrap roles, so what it can change is bounded by the bootstrap |
| Build | CDK builds the Docker image from [`apps/api/Dockerfile`](../apps/api/Dockerfile) (API + built SPA), pushes it to ECR, then deploys the stack |
| Result | The app URL is written to the run summary and the `dev` environment page |

One-time setup (already done for this account): `cdk bootstrap`, then deploy the `happy-path-github-oidc`
stack from a laptop with `aws login`, then set the GitHub variables. See the README.

---

## 5. Request flows

### 5.1 Register and sign in (email and password)

```mermaid
sequenceDiagram
    autonumber
    actor B as Browser (React SPA)
    participant A as NestJS API
    participant D as DynamoDB

    B->>A: POST /api/auth/register {email, password, name}
    Note over A: ValidationPipe rejects unknown fields<br/>Throttler limits credential endpoints
    A->>A: hash password with argon2id
    A->>D: TransactWrite: put USER#id and EMAIL#email<br/>(both with attribute_not_exists)
    alt email already registered
        D-->>A: TransactionCanceled
        A-->>B: 409 Conflict
    else created
        A->>A: sign JWT (secret from Secrets Manager)
        A-->>B: 201 user + Set-Cookie access_token (httpOnly)
    end

    B->>A: GET /api/auth/me (cookie sent automatically)
    A->>A: verify JWT
    A->>D: GetItem USER#id
    A-->>B: 200 public user (never the password hash)
```

Sign-in (`POST /api/auth/login`) looks up `EMAIL#email`, then `USER#id`, and verifies the argon2id hash.
When the email does not exist it still runs a dummy hash, so response times do not reveal which emails are registered.

### 5.2 Sign in with Google (OAuth 2.0 authorization code flow)

```mermaid
sequenceDiagram
    autonumber
    actor B as Browser
    participant A as NestJS API
    participant G as Google
    participant D as DynamoDB

    B->>A: GET /api/auth/google
    A-->>B: 302 to Google + Set-Cookie oauth_state (10 min, httpOnly)
    B->>G: consent screen
    G-->>B: 302 /api/auth/google/callback?code&state
    B->>A: callback (with the oauth_state cookie)
    A->>A: compare state with the cookie (timing-safe), CSRF check
    A->>G: exchange code for tokens, read the profile
    alt email not verified by Google
        A-->>B: 302 /login?error=google
    else
        A->>D: find GOOGLE#sub, or link via EMAIL#email, or create a new user
        A-->>B: Set-Cookie access_token + 302 to /
    end
```

Google sign-in is switched on only when a Google OAuth client is configured (Secrets Manager in AWS,
`.env` locally). Otherwise `/api/auth/google` returns 404 and the SPA hides the button.

---

## 6. Data model (DynamoDB single-table)

One table with a string partition key `pk`, no sort key, no secondary indexes, on-demand billing,
point-in-time recovery on.

```mermaid
flowchart LR
    e["EMAIL#alice@example.com<br/>{ userId }"] --> u["USER#7f3c…<br/>{ id, email, name, passwordHash?,<br/>googleId?, avatarUrl?, createdAt }"]
    g["GOOGLE#1098…<br/>{ userId }"] --> u
```

| Item `pk` | Purpose | Written with |
|---|---|---|
| `USER#<id>` | The user profile | `attribute_not_exists(pk)` on create |
| `EMAIL#<email>` | Pointer to the user; makes emails unique | Same transaction as the user item |
| `GOOGLE#<sub>` | Pointer to the user; one user per Google account | Same transaction (or when linking) |

Uniqueness is guaranteed by DynamoDB conditional transactional writes, not by application checks, so two
simultaneous sign-ups with the same email cannot both succeed.

---

## 7. Security controls

| Area | Control | Where |
|---|---|---|
| Identity for CI | GitHub OIDC; no long-lived AWS keys; role limited to CDK bootstrap roles and the `dev` environment | `infra/lib/github-oidc-stack.ts` |
| Passwords | argon2id (19 MiB memory, 2 iterations); dummy hash for unknown emails | `apps/api/src/auth/auth.service.ts` |
| Session | Signed JWT in an httpOnly, SameSite=Lax cookie; Secure whenever the public URL is https | `apps/api/src/auth/auth-cookie.ts` |
| OAuth CSRF | Random `state` in a short-lived httpOnly cookie, compared in constant time | `apps/api/src/auth/oauth-state.store.ts` |
| Input | Global ValidationPipe; unknown fields rejected | `apps/api/src/main.ts` |
| Abuse | Rate limiting on credential endpoints | `@nestjs/throttler` |
| Headers | Helmet; CloudFront security headers policy | `main.ts`, `poc-stack.ts` |
| Secrets | Secrets Manager, injected into the task at start; never in code, env files or logs | `poc-stack.ts` |
| Network | API tasks in private subnets; DynamoDB through a gateway endpoint; ALB only forwards CloudFront traffic | `poc-stack.ts` |
| Data | S3 private + KMS + TLS-only; DynamoDB PITR; prod: deletion protection and RETAIN | `poc-stack.ts` |
| Container | Non-root `node` user, read-only root filesystem, deployment circuit breaker with rollback | `Dockerfile`, `poc-stack.ts` |
| Guardrails | cdk-nag AwsSolutions checks fail the build; every exception is acknowledged with a reason | `poc-stack.ts` |
| Audit | VPC flow logs and API logs in CloudWatch (30 days); a correlation ID on every request | `poc-stack.ts`, `request-context.middleware.ts` |

Known gaps for the POC (tracked in the README "Production hardening" list): WAF, custom domain + ACM,
access logs for ALB/CloudFront/S3, secret rotation, alarms and tracing, and HTTPS while `hosting=alb` is on.

---

## 8. Environments

| Setting | dev | uat | prod |
|---|---|---|---|
| NAT gateways | 1 | 1 | 2 |
| API tasks (min-max) | 1-2 | 1-2 | 2-6 |
| Removal policy | DESTROY | DESTROY | RETAIN |
| DynamoDB deletion protection | off | off | on |
| `hosting=alb` allowed | yes (temporary) | no | no |
| Deployed by | GitHub Actions on `main` | pipeline (not set up yet) | pipeline (not set up yet) |

Main running costs per environment: the NAT gateway, the ALB, and the Fargate task(s). DynamoDB, S3,
CloudFront and Secrets Manager cost little at POC traffic. Destroy dev when it is not in use
(`pnpm exec cdk destroy happy-path-dev`).

---

## 9. Local development

```mermaid
flowchart LR
    b(["Browser<br/>localhost:5173"]) --> v["Vite dev server :5173<br/>React SPA + HMR"]
    v -- "proxy /api/*" --> n["NestJS API :3000<br/>(nest start --watch)"]
    n --> m[("In-memory store<br/>DB_DRIVER=memory")]
    n -. "optional" .-> l[("DynamoDB Local :8000<br/>docker compose")]
```

Local development mirrors AWS's single-origin setup: the Vite proxy plays the role of CloudFront, so the
cookie and routing behave the same as in AWS.
