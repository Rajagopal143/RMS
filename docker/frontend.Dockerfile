# syntax=docker/dockerfile:1.7
#
# Shared build for every Vite app in apps/* (admin, worker, ...).
# Build context is the repo root because the apps consume workspace packages.
#
#   docker build -f docker/frontend.Dockerfile --build-arg APP_NAME=admin .

ARG NODE_VERSION=22-alpine
ARG NGINX_VERSION=1.29-alpine

# ---------------------------------------------------------------- dependencies
FROM node:${NODE_VERSION} AS deps
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

# Only the manifests, so the install layer is cached until a package.json changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/admin/package.json ./apps/admin/
COPY apps/worker/package.json ./apps/worker/
COPY apps/backend/package.json ./apps/backend/
COPY packages/db/package.json ./packages/db/
COPY packages/ui/package.json ./packages/ui/
COPY packages/eslint-config/package.json ./packages/eslint-config/
COPY packages/typescript-config/package.json ./packages/typescript-config/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ---------------------------------------------------------------------- build
FROM deps AS build
ARG APP_NAME
RUN test -n "$APP_NAME" || (echo "APP_NAME build arg is required" && exit 1)
COPY . .
RUN pnpm --filter "$APP_NAME" build

# -------------------------------------------------------------------- runtime
FROM nginx:${NGINX_VERSION} AS runtime
ARG APP_NAME
ENV APP_NAME=${APP_NAME}

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/${APP_NAME}/dist /usr/share/nginx/html

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
