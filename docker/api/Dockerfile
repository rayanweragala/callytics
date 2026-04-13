FROM node:20-alpine

WORKDIR /app

COPY package.json ./package.json
COPY backend/package.json ./backend/package.json

RUN npm install --workspace backend

COPY backend ./backend

WORKDIR /app/backend

RUN npm run build

CMD ["node", "dist/main.js"]
