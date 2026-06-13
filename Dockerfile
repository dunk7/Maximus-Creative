# Maximus production image for Akash (and any Docker host).
# Build: docker build -t maximus-core:latest .
FROM node:20-bookworm-slim AS deps

WORKDIR /app
COPY package.json package-lock.json .npmrc.production ./
COPY scripts/fix-uuid.sh scripts/fix-uuid.sh
COPY packages/agent-runtime/package.json packages/agent-runtime/
COPY packages/tools/package.json packages/tools/
COPY apps/core/package.json apps/core/

# Full install (incl. devDeps) — tsc needs @types/* during build.
RUN cp .npmrc.production .npmrc \
  && npm ci --include=dev \
    --workspace=@maximus/agent-runtime \
    --workspace=@maximus/tools \
    --workspace=@maximus/core \
  && bash -c 'rm -rf node_modules/rpc-websockets/node_modules/uuid 2>/dev/null || true'

FROM node:20-bookworm-slim AS prod-deps

WORKDIR /app
COPY package.json package-lock.json .npmrc.production ./
COPY scripts/fix-uuid.sh scripts/fix-uuid.sh
COPY packages/agent-runtime/package.json packages/agent-runtime/
COPY packages/tools/package.json packages/tools/
COPY apps/core/package.json apps/core/

RUN cp .npmrc.production .npmrc \
  && npm ci --omit=dev \
    --workspace=@maximus/agent-runtime \
    --workspace=@maximus/tools \
    --workspace=@maximus/core \
  && bash -c 'rm -rf node_modules/rpc-websockets/node_modules/uuid 2>/dev/null || true'

FROM node:20-bookworm-slim AS build

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/core ./apps/core

RUN npm run build --workspace=@maximus/agent-runtime \
  && npm run build --workspace=@maximus/tools \
  && npm run build --workspace=@maximus/core

FROM node:20-bookworm-slim AS runtime

WORKDIR /opt/maximus

ENV NODE_ENV=production
ENV WAKE_PORT=4747
ENV MAXIMUS_RUNTIME_PROFILE=akash

COPY --from=build /app/apps/core/dist ./apps/core/dist
COPY --from=build /app/packages/agent-runtime/dist ./packages/agent-runtime/dist
COPY --from=build /app/packages/tools/dist ./packages/tools/dist
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages/agent-runtime/package.json ./packages/agent-runtime/package.json
COPY --from=build /app/packages/tools/package.json ./packages/tools/package.json
COPY --from=build /app/apps/core/package.json ./apps/core/package.json
COPY genesis ./genesis
COPY scripts/start-maximus.sh scripts/fix-uuid.sh scripts/akash-entrypoint.sh ./scripts/

RUN chmod +x scripts/start-maximus.sh scripts/fix-uuid.sh scripts/akash-entrypoint.sh \
  && mkdir -p data wallet \
  && bash scripts/fix-uuid.sh

EXPOSE 4747

ENTRYPOINT ["bash", "scripts/akash-entrypoint.sh"]
