# syntax=docker/dockerfile:1

# Dependencies shared by the stages below.
FROM node:22-alpine AS deps
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Static build of the admin dashboard (dist/admin-ui).
FROM deps AS admin-ui
COPY . .
RUN pnpm build:ui

# Admin: dashboard, API and data plane in one process (tsx runs src/cli.ts, like `pnpm admin:start`).
FROM deps AS admin
ENV NODE_ENV=production
COPY package.json pnpm-lock.yaml ./
COPY src ./src
COPY --from=admin-ui /app/dist/admin-ui ./dist/admin-ui
EXPOSE 8788
HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=6 \
  CMD wget -qO- http://127.0.0.1:8788/api/health >/dev/null || exit 1
CMD ["pnpm", "admin:start"]
