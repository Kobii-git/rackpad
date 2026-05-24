# syntax=docker/dockerfile:1.7

FROM --platform=$BUILDPLATFORM node:22-bookworm-slim AS deps
WORKDIR /app

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm,sharing=locked npm ci

FROM deps AS build
WORKDIR /app

COPY . .
RUN npm run build

FROM --platform=$TARGETPLATFORM node:22-bookworm-slim AS prod-deps
WORKDIR /app

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm,sharing=locked npm ci --omit=dev

FROM --platform=$TARGETPLATFORM node:22-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
ENV DATABASE_PATH=/data/rackpad.db

RUN apt-get update \
  && apt-get install -y --no-install-recommends arp-scan iproute2 iputils-ping net-tools nmap \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system rackpad \
  && useradd --system --gid rackpad --uid 10001 --create-home rackpad \
  && mkdir -p /data

COPY --from=prod-deps --chown=rackpad:rackpad /app/node_modules ./node_modules
COPY --from=build --chown=rackpad:rackpad /app/dist ./dist
COPY --from=build --chown=rackpad:rackpad /app/dist-server ./dist-server
COPY --from=build --chown=rackpad:rackpad /app/scripts/collect-hyperv.ps1 ./scripts/collect-hyperv.ps1
COPY --from=build --chown=rackpad:rackpad /app/scripts/collect-proxmox.sh ./scripts/collect-proxmox.sh
# package.json is read at runtime by admin/export to embed the app version in backups
COPY --from=build --chown=rackpad:rackpad /app/package.json ./package.json

RUN chown -R rackpad:rackpad /data

USER rackpad

VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then((res) => process.exit(res.ok ? 0 : 1)).catch(() => process.exit(1))"

EXPOSE 3000
CMD ["node", "dist-server/index.js"]
