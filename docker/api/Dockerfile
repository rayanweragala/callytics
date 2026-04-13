FROM node:20-bookworm-slim

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip ffmpeg \
    && pip3 install --break-system-packages piper-tts==1.4.2 \
    && rm -rf /var/lib/apt/lists/*

COPY backend/voices/ /app/storage/audio/voices/
COPY package.json ./package.json
COPY backend/package.json ./backend/package.json

RUN npm install --workspace backend

COPY backend ./backend

WORKDIR /app/backend

RUN npm run build

CMD ["node", "dist/main.js"]
