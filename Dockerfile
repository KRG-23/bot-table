FROM node:20-bookworm-slim AS base
WORKDIR /usr/src/app
RUN apt-get update -y \
  && apt-get install -y openssl ca-certificates postgresql-client \
  && update-ca-certificates \
  && rm -rf /var/lib/apt/lists/*

FROM base AS deps
COPY package*.json ./
COPY prisma ./prisma
ENV npm_config_cache=/root/.npm
ENV npm_config_fetch_retries=5 \
  npm_config_fetch_retry_mintimeout=10000 \
  npm_config_fetch_retry_maxtimeout=120000 \
  npm_config_fetch_timeout=600000
RUN --mount=type=cache,target=/root/.npm \
  HUSKY=0 PRISMA_SKIP_POSTINSTALL=1 npm ci --prefer-offline --no-audit
RUN npm run prisma:generate

FROM deps AS build
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM base AS prod
ENV NODE_ENV=production
COPY --from=deps /usr/src/app/package*.json ./
COPY --from=deps /usr/src/app/node_modules ./node_modules
COPY --from=build /usr/src/app/dist ./dist
COPY --from=deps /usr/src/app/prisma ./prisma
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
