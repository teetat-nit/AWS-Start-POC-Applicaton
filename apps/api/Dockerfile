# Build context = repository root (pnpm workspace). Built by CDK (infra) or:
#   docker build -f apps/api/Dockerfile -t poc-api .
FROM node:26-alpine AS base
RUN npm install -g pnpm@12.23.0
WORKDIR /repo

FROM base AS manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY infra/package.json infra/

FROM manifests AS build
RUN pnpm install --frozen-lockfile --filter api
COPY apps/api apps/api
RUN pnpm --filter api build

FROM manifests AS prod-deps
RUN pnpm install --frozen-lockfile --prod --filter api

FROM node:26-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=prod-deps --chown=node:node /repo/node_modules ./node_modules
COPY --from=prod-deps --chown=node:node /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=build --chown=node:node /repo/apps/api/dist ./apps/api/dist
COPY --chown=node:node apps/api/package.json ./apps/api/
WORKDIR /repo/apps/api
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "dist/main.js"]
