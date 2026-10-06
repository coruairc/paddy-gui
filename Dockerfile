# Paddy desk — local web client for OpenCode.
# Image: ghcr.io/coruairc/paddy-gui
#
#   docker run --rm -p 127.0.0.1:8080:8080 \
#     -e OPENCODE_WEB_HOST=127.0.0.1 \
#     ghcr.io/coruairc/paddy-gui:latest
#
# Paddy is the interface. OpenCode does the work. The container runs the dev
# server in the background; the controller middleware exposes /api for the
# browser and starts OpenCode on 127.0.0.1:4096 inside the container.

FROM node:24-bookworm-slim AS base

ENV DEBIAN_FRONTEND=noninteractive \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false \
    PATH="/root/.opencode/bin:${PATH}"

# Install OpenCode. The installer is non-interactive; --no-modify-path keeps
# PATH and rc files inside the image to the one line above.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && curl -fsSL https://opencode.ai/install | bash -s -- --no-modify-path \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* \
    && opencode --version

WORKDIR /app

# Install dependencies first so source edits don't bust the cache.
COPY package.json package-lock.json ./
COPY bin ./bin
COPY scripts ./scripts
RUN npm ci --include=optional --no-fund --no-audit

# Copy the rest of the source.
COPY bin ./bin
COPY public ./public
COPY src ./src
COPY index.html* tsconfig.json vite.config.ts SELFHOST* ./

# The host port is intended to be published on loopback by default. The Vite
# process listens on the container interface, while OPENCODE_WEB_HOST tells
# the controller whether the published application is local-only or remote.
ENV OPENCODE_WEB_HOST=127.0.0.1 \
    PORT=8080

EXPOSE 8080

# Health check probes /api/status, which the controller always serves.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS http://127.0.0.1:8080/api/status > /dev/null || exit 1

# The wrapper picks up OPENCODE_WEB_HOST and OPENCODE_WEB_TOKEN, binds to
# 0.0.0.0:8080, and starts the dev controller. npm run dev runs vite dev
# which mounts the controller middleware on every /api request.
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "8080"]
