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
# NEXT_PUBLIC_* are inlined into the CLIENT bundle at build time, so they must be present for
# `next build` (they are NOT runtime Cloud Run env). The public Identity Platform web config is
# project-identifying, not a secret — pass from the auth_web_api_key/auth_domain Terraform outputs.
ARG NEXT_PUBLIC_FIREBASE_API_KEY
ARG NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
ARG NEXT_PUBLIC_FIREBASE_PROJECT_ID
ENV NEXT_PUBLIC_FIREBASE_API_KEY=$NEXT_PUBLIC_FIREBASE_API_KEY
ENV NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=$NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
ENV NEXT_PUBLIC_FIREBASE_PROJECT_ID=$NEXT_PUBLIC_FIREBASE_PROJECT_ID
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
# #184: commit-stamp the image — the OCI revision label (queryable on the registry) + a runtime ENV the
# container self-reports via the /version route, so the deploy verify-gate can assert running_sha ==
# deployed_sha before promoting traffic. Closes the "fresh SHA tag, stale bytes" gap at deploy time.
ARG GIT_SHA=dev
LABEL org.opencontainers.image.revision=$GIT_SHA
ENV GIT_SHA=$GIT_SHA
RUN useradd --uid 1001 --create-home app
USER app
# Standalone bundles server.js + a minimal traced node_modules; static assets ship separately.
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
EXPOSE 8080
CMD ["node", "server.js"]
