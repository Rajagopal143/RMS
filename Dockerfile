# Production image for RMS. One build gives three things:
#   app: the API, the live-updates service and the database migrations (run with tsx, no compile step)
#   web: the two web apps, built, behind Caddy
# The desktop app (Electron) is for the counter computer and isn't part of this.

FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.4.1 --activate
WORKDIR /repo
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
COPY . .
RUN pnpm install --frozen-lockfile

FROM base AS build
RUN pnpm --filter admin build && pnpm --filter worker build

FROM base AS app
ENV NODE_ENV=production

FROM caddy:2-alpine AS web
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/admin/dist /srv/admin
COPY --from=build /repo/apps/worker/dist /srv/worker
