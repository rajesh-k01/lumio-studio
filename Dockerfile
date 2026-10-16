# syntax=docker/dockerfile:1

# ---------------------------------------------------------------- deps stage
# Production dependencies only. Dev deps (eslint) never reach the runtime image.
FROM node:22-bookworm-slim AS deps
WORKDIR /app

COPY package.json package-lock.json ./
# sharp ships prebuilt binaries for linux/amd64 and linux/arm64 on bookworm, so
# no build-essential is needed here. If you force a source build, add
# python3 make g++ to this stage.
RUN npm ci --omit=dev --no-audit --no-fund


# -------------------------------------------------------------- runtime stage
FROM node:22-bookworm-slim AS runtime

# ffmpeg + ffprobe back the video worker. Without them the server still boots
# but /api/health reports ffmpeg:false and video routes return 503.
# ca-certificates is required for outbound TLS.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ffmpeg \
      ca-certificates \
      tini \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PORT=3000 \
    LUMIO_DB=/app/data/lumio.db

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY server ./server
COPY public ./public
COPY scripts ./scripts
COPY ai ./ai

# /app/data is the mount point for the persistent volume that holds the SQLite
# database. It MUST be owned by the unprivileged `node` user or every write
# fails with EACCES. Only this directory needs to be writable -- the copied
# source is read-only at runtime, so there is no need to chown node_modules.
RUN mkdir -p /app/data && chown node:node /app/data

USER node

EXPOSE 3000

# Uses node's built-in fetch so the image needs no curl/wget.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# tini reaps zombies and forwards SIGTERM, which server/index.js handles for a
# clean database close.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server/index.js"]