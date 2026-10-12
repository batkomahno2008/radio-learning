# Test data for the Trivy checks (issue #4). Not a real Dockerfile. It obeys policy sections 7 and 8.2.
FROM node:24.21.0-trixie-slim@sha256:173f125896c3b47ddf056734c7ea789d04595a6a08769a8f78e0df642781fb66 AS base
WORKDIR /app
COPY package*.json ./

FROM base AS deps
RUN npm ci --omit=dev

FROM scratch AS empty

FROM node:24.21.0-trixie-slim@sha256:173f125896c3b47ddf056734c7ea789d04595a6a08769a8f78e0df642781fb66 AS runtime
WORKDIR /app
COPY --from=deps /app/node_modules /app/node_modules
COPY server.js ./
USER 10001
HEALTHCHECK CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1))"]
CMD ["node", "server.js"]
