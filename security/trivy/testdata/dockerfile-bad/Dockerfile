# Test data for the Trivy checks (issue #4). Not a real Dockerfile. It has known faults:
# no digest on two FROM lines, no USER, no HEALTHCHECK.
FROM node:24.21.0-trixie-slim AS base
WORKDIR /app
COPY package*.json ./

FROM base AS test
RUN npm ci

FROM nginxinc/nginx-unprivileged:stable-alpine AS proxy
COPY public /usr/share/nginx/html

FROM node:24.21.0-trixie-slim@sha256:173f125896c3b47ddf056734c7ea789d04595a6a08769a8f78e0df642781fb66 AS runtime
WORKDIR /app
COPY --from=base /app /app
CMD ["node", "server.js"]
