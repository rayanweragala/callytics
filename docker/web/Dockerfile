FROM node:20-alpine AS build

WORKDIR /app

COPY package.json ./package.json
COPY frontend/package.json ./frontend/package.json

RUN npm install --workspace frontend

COPY frontend ./frontend

WORKDIR /app/frontend

RUN npm run build

FROM nginx:alpine

COPY docker/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html

EXPOSE 3000

CMD ["nginx", "-g", "daemon off;"]
