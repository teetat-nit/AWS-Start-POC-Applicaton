# CLAUDE.md

pnpm workspace: `apps/api` (NestJS 12), `apps/web` (React 19 + Vite 8), `infra` (AWS CDK). See README.md.

## Commands
- Install: `pnpm install` (on the corporate network set `NODE_USE_SYSTEM_CA=1`; never disable strict-ssl)
- Dev: `pnpm dev` (API :3000, web :5173 with `/api` proxy). API config in `apps/api/.env` (copy `.env.example`)
- Gates: `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm synth`

## Conventions
- API: controllers thin → services (business rules, throw `DomainError`s from `src/common/errors.ts`) → `UsersRepository` (DynamoDB / in-memory). Map new domain errors in `DomainExceptionFilter`.
- DTOs use class-validator; the global ValidationPipe rejects unknown fields.
- Config only via `loadAppConfig` (`src/config/app-config.ts`), injected with `@Inject(APP_CONFIG)`. Add new env vars there, in `.env.example`, and in the CDK task definition (secrets via Secrets Manager).
- Never return `User` to clients; use `toPublicUser`. Never log tokens, passwords or request bodies.
- API module format follows the Nest 12 starter: `module: nodenext`, CommonJS output; Jest runs with `--experimental-vm-modules`.
- TypeScript is pinned to `~6.0` (TS 7 not yet supported by ts-jest / typescript-eslint).
- pnpm keeps its 1-day `minimumReleaseAge` guard: widen version ranges rather than adding excludes.
- Web: server state through TanStack Query hooks in `src/hooks`, HTTP only through `src/lib/api.ts`.
- Infra: cdk-nag v3 (`Validations.of(...)`); acknowledge findings with a reason, never disable the plugin.
