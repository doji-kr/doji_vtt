# syntax=docker/dockerfile:1

# ── deps: 워크스페이스 의존성 설치 (better-sqlite3 네이티브 빌드를 위해 빌드 도구 포함) ──
FROM node:22-slim AS deps
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/schema/package.json packages/schema/package.json
COPY packages/runtime/package.json packages/runtime/package.json
COPY packages/pixel-ui/package.json packages/pixel-ui/package.json
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/cli/package.json apps/cli/package.json
RUN pnpm install --frozen-lockfile

# ── build: 웹 정적 자산 빌드 ──
FROM deps AS build
COPY . .
RUN pnpm --filter @hearthside/web build

# ── runtime: 실행 이미지. 빌드 도구·소스 컴파일러 없이 산출물만 ──
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    DATA_DIR=/data \
    CONTENT_DIR=/app/content/modules \
    WEB_DIST=/app/apps/web/dist \
    PORT=3000

COPY --from=build /app ./

RUN groupadd --system hearthside \
    && useradd --system --gid hearthside --home /app hearthside \
    && mkdir -p /data \
    && chown -R hearthside:hearthside /app /data

USER hearthside
EXPOSE 3000
CMD ["node_modules/.bin/tsx", "apps/server/src/index.ts"]
