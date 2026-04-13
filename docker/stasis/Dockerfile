FROM node:20-alpine

WORKDIR /app

COPY package.json ./package.json
COPY stasis/package.json ./stasis/package.json

RUN npm install --workspace stasis

COPY stasis ./stasis

WORKDIR /app/stasis

RUN npm run build

CMD ["node", "dist/index.js"]
