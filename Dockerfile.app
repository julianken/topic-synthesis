# syntax=docker/dockerfile:1
# Cloud Run SERVICE image — the Next.js app in standalone output (only the traced deps; lean,
# scale-to-zero). Cloud Run injects $PORT (8080); server.js honors it.
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
RUN useradd --uid 1001 --create-home app
USER app
# Standalone bundles server.js + a minimal traced node_modules; static assets ship separately.
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
EXPOSE 8080
CMD ["node", "server.js"]
