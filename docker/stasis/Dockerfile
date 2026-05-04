# syntax=docker/dockerfile:1.7
FROM node:20-alpine

WORKDIR /app
ENV NPM_CONFIG_AUDIT=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_FETCH_RETRIES=5 \
    NPM_CONFIG_FETCH_RETRY_FACTOR=2 \
    NPM_CONFIG_FETCH_RETRY_MINTIMEOUT=20000 \
    NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=120000 \
    NPM_CONFIG_FETCH_TIMEOUT=180000

COPY package.json ./package.json
COPY package-lock.json ./package-lock.json
COPY stasis/package.json ./stasis/package.json

RUN --mount=type=cache,target=/root/.npm npm ci --workspace stasis --prefer-offline --no-audit --no-fund

COPY stasis ./stasis

WORKDIR /app/stasis

RUN npm run build

CMD ["node", "dist/index.js"]
