# syntax=docker/dockerfile:1

# ---- build stage ------------------------------------------------
FROM node:22-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- runtime stage ----------------------------------------------
FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

# Cloud Run は PORT を注入する。本番は HTTP モードで Events API を受ける。
ENV SLACK_MODE=http
ENV PORT=8080
EXPOSE 8080

USER node
CMD ["node", "dist/index.js"]
