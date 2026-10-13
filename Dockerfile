# syntax=docker/dockerfile:1@sha256:4edf897a3ffa55b89f906fc8cc78afdb3f1834cc9c7083565e611a8a7d5fe99e

# One Dockerfile builds all images of the product (epic #1, decision D7).
#
#   test     runs the API tests. It is not an image to run.
#   e2e      the Cucumber and Playwright runner. It has no app code. CI only.
#   proxy    NGINX with the config and the static files. It has no app code.
#   runtime  the Node app. It has no tests and no static files. This is the
#            last stage, so `docker build .` makes this image.
#
# Each base image has a tag for the reader and a digest for the build. The
# Node version agrees with .nvmrc.

# ---------------------------------------------------------------------------
# base: Node and the work directory
# ---------------------------------------------------------------------------
FROM node:24.21.0-trixie-slim@sha256:173f125896c3b47ddf056734c7ea789d04595a6a08769a8f78e0df642781fb66 AS base
WORKDIR /app
ENV NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false

# ---------------------------------------------------------------------------
# deps-prod: the dependencies of the app only (no dev dependencies)
# ---------------------------------------------------------------------------
FROM base AS deps-prod
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev

# ---------------------------------------------------------------------------
# app-deps: the dependencies that the app needs at run time. hls.js is a
# browser library: only the proxy image serves it (the hls stage below).
# ---------------------------------------------------------------------------
FROM deps-prod AS app-deps
RUN rm -rf node_modules/hls.js

# ---------------------------------------------------------------------------
# hls: the hls.js files for the browser. The source maps, the demo and the type
# files are not needed to play audio, and they are about 20 MB.
# ---------------------------------------------------------------------------
FROM deps-prod AS hls
RUN mkdir /hls \
    && cp -a node_modules/hls.js/dist/. /hls/ \
    && cd /hls \
    && rm -f ./*.map ./hls-demo.js ./*.d.ts ./*.d.mts

# ---------------------------------------------------------------------------
# deps-dev: all dependencies, for the API tests
# ---------------------------------------------------------------------------
FROM base AS deps-dev
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci

# ---------------------------------------------------------------------------
# test: run the API tests (pg-mem, no network, no Postgres, no browser).
# The runtime and proxy stages copy /test-passed. So a build of either image
# fails when a test fails. No test file enters those images.
# ---------------------------------------------------------------------------
FROM deps-dev AS test
COPY package.json app.js config.js db.js schema.sql ./
COPY public ./public
COPY tests/api ./tests/api
RUN --network=none npm run test:api \
    && touch /test-passed

# ---------------------------------------------------------------------------
# e2e: the E2E runner. It copies the tests only. It has no server code and it
# needs the app at BASE_URL (for staging, the NGINX entry point).
# The Playwright image has Chromium. Its version must agree with the
# "playwright" version in package-lock.json.
# ---------------------------------------------------------------------------
FROM mcr.microsoft.com/playwright:v1.64.0-noble@sha256:06a9939e57531807f8d5fd76ce44b53165ffb7d7501d87ab10e285c20b1e971f AS e2e
WORKDIR /e2e
RUN chown pwuser:pwuser /e2e
USER pwuser
ENV NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false
COPY --chown=pwuser:pwuser package.json package-lock.json ./
RUN --mount=type=cache,target=/home/pwuser/.npm,uid=1001,gid=1001 \
    npm ci
COPY --chown=pwuser:pwuser cucumber.js stream_URL.txt ./
COPY --chown=pwuser:pwuser tests ./tests
# The suite writes reports/cucumber.html here. Mount a volume to get the report.
RUN mkdir reports
ENTRYPOINT ["npx", "cucumber-js"]

# Throwaway stage for the scan test (do not merge). No target uses it.
FROM ubuntu:latest AS scan-test
USER root
ADD http://example.com/x.tar.gz /opt/

# ---------------------------------------------------------------------------
# proxy: NGINX, the config and the static files
# ---------------------------------------------------------------------------
FROM nginxinc/nginx-unprivileged:1.30.5-alpine3.24@sha256:56b8272e43a0525f67aed68d1e0794a712d10e3e45a563e118e9a77c817e6f86 AS proxy
# The base image runs as UID 101. Switch to root only for the file changes.
USER root
RUN rm -f /etc/nginx/conf.d/default.conf
COPY deploy/nginx/nginx.conf /etc/nginx/nginx.conf
COPY deploy/nginx/templates/ /etc/nginx/templates/
COPY deploy/nginx/snippets/ /etc/nginx/snippets/
# /docker-entrypoint.sh sources this file, and it needs the execute bit.
# tls/ stays out of the image: Compose mounts tls.conf when TLS is on.
COPY --chmod=0755 deploy/nginx/docker-entrypoint.d/15-radio-learning.envsh /docker-entrypoint.d/15-radio-learning.envsh
COPY public/ /usr/share/nginx/html/
COPY --from=hls /hls/ /usr/share/nginx/vendor/hls/
COPY --from=test /test-passed /tmp/test-passed
USER 101
EXPOSE 8080 8443
# NGINX answers /healthz itself. The check does not call the app.
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --start-interval=1s --retries=3 \
    CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8080/healthz"]
ARG IMAGE_SOURCE=https://github.com/batkomahno2008/radio-learning
ARG IMAGE_REVISION=unknown
ARG IMAGE_VERSION=dev
ARG IMAGE_CREATED=unknown
LABEL org.opencontainers.image.title="radio-learning-proxy" \
      org.opencontainers.image.source="${IMAGE_SOURCE}" \
      org.opencontainers.image.revision="${IMAGE_REVISION}" \
      org.opencontainers.image.version="${IMAGE_VERSION}" \
      org.opencontainers.image.created="${IMAGE_CREATED}"

# ---------------------------------------------------------------------------
# runtime: the Node app. This is the default target (the last stage).
# The files are root-owned and read-only for the app user. The app writes
# nothing, so Compose and Kubernetes can use a read-only root file system.
# ---------------------------------------------------------------------------
FROM base AS runtime
# The app needs Node only. Remove npm, npx, corepack and yarn: they are not
# needed to run the app, and they add files that can have known faults.
RUN rm -rf /usr/local/lib/node_modules /usr/local/include /usr/local/share/doc \
        /usr/local/share/man /usr/local/bin/npm /usr/local/bin/npx \
        /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg \
        /opt/yarn-v1.22.22
COPY --from=app-deps /app/node_modules ./node_modules
COPY package.json server.js app.js db.js config.js schema.sql stream_URL.txt ./
COPY --from=test /test-passed /tmp/test-passed
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    SERVE_STATIC=false \
    TRUST_PROXY=1
EXPOSE 3000
# The numeric ID of the user "node". Kubernetes (runAsNonRoot) needs a number.
USER 1000:1000
# The image has no curl. /api/health does not call the database.
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --start-interval=1s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
ARG IMAGE_SOURCE=https://github.com/batkomahno2008/radio-learning
ARG IMAGE_REVISION=unknown
ARG IMAGE_VERSION=dev
ARG IMAGE_CREATED=unknown
LABEL org.opencontainers.image.title="radio-learning" \
      org.opencontainers.image.source="${IMAGE_SOURCE}" \
      org.opencontainers.image.revision="${IMAGE_REVISION}" \
      org.opencontainers.image.version="${IMAGE_VERSION}" \
      org.opencontainers.image.created="${IMAGE_CREATED}"
# Exec form: Node is PID 1 and gets SIGTERM. Do not start the app with npm.
ENTRYPOINT ["node", "server.js"]
