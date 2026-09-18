# syntax=docker/dockerfile:1.7
#
# Bun + Express API (apps/backend). Build context is the repo root.
#
#   docker build -f docker/backend.Dockerfile .

ARG BUN_VERSION=1.3-alpine

# ---------------------------------------------------------------- dependencies
FROM oven/bun:${BUN_VERSION} AS deps
WORKDIR /app
COPY apps/backend/package.json apps/backend/bun.lock ./
RUN --mount=type=cache,id=bun-cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile --production

# -------------------------------------------------------------------- runtime
FROM oven/bun:${BUN_VERSION} AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY apps/backend/package.json apps/backend/tsconfig.json ./
COPY apps/backend/index.ts ./

USER bun
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD bun -e "await fetch('http://127.0.0.1:3000/')" || exit 1

CMD ["bun", "run", "index.ts"]
