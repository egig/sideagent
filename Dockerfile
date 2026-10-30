# syntax=docker/dockerfile:1

# Dependencies shared by both targets.
FROM node:22-alpine AS deps
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Static build of the demo chat UI.
FROM deps AS build
COPY . .
RUN pnpm exec vite build demo --outDir dist

# Demo API + agent (tsx runs the TypeScript sources directly, like `pnpm demo:api`).
FROM deps AS api
ENV NODE_ENV=production
COPY package.json pnpm-lock.yaml ./
COPY src ./src
COPY demo ./demo
EXPOSE 8787
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=6 \
  CMD wget -qO- http://127.0.0.1:8787/healthz >/dev/null || exit 1
CMD ["pnpm", "demo:api"]

# Nginx serves the UI and proxies /agent to the API (SSE needs buffering off).
FROM nginx:1.27-alpine AS web
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/demo/dist /usr/share/nginx/html
EXPOSE 80
