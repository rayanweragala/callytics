# syntax=docker/dockerfile:1.7
FROM node:20-bookworm-slim

WORKDIR /app
ENV NPM_CONFIG_AUDIT=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_FETCH_RETRIES=5 \
    NPM_CONFIG_FETCH_RETRY_FACTOR=2 \
    NPM_CONFIG_FETCH_RETRY_MINTIMEOUT=20000 \
    NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=120000 \
    NPM_CONFIG_FETCH_TIMEOUT=180000

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip ffmpeg \
    && pip3 install --break-system-packages piper-tts==1.4.2 \
    && rm -rf /var/lib/apt/lists/*

COPY backend/voices/ /app/storage/audio/voices/
COPY package.json ./package.json
COPY package-lock.json ./package-lock.json
COPY backend/package.json ./backend/package.json

RUN --mount=type=cache,target=/root/.npm npm ci --workspace backend --prefer-offline --no-audit --no-fund

COPY backend ./backend

WORKDIR /app/backend

RUN npm run build

CMD ["node", "dist/main.js"]
