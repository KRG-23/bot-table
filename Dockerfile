FROM node:20-bookworm-slim AS base
WORKDIR /usr/src/app
RUN apt-get update -y \
  && apt-get install -y openssl ca-certificates \
  && update-ca-certificates \
  && rm -rf /var/lib/apt/lists/*

FROM base AS deps
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci
RUN npm run prisma:generate

FROM deps AS build
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-bookworm-slim AS prod
WORKDIR /usr/src/app
ENV NODE_ENV=production
COPY --from=deps /usr/src/app/package*.json ./
COPY --from=deps /usr/src/app/node_modules ./node_modules
COPY --from=build /usr/src/app/dist ./dist
CMD ["node", "dist/index.js"]
