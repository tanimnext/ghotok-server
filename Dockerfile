# syntax=docker/dockerfile:1
# Ghotok API (Express). Build from the repository root:
#   docker build -f server/Dockerfile -t ghotok-api .

FROM node:22-alpine AS deps
WORKDIR /app
# Every workspace manifest is needed for `npm ci` to accept the lockfile.
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY ui/package.json ui/
COPY server/package.json server/
COPY web/package.json web/
COPY admin/package.json admin/
RUN npm ci --workspace server --omit=dev --ignore-scripts && npm cache clean --force

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY shared ./shared
COPY server ./server
# Local uploads (STORAGE_DRIVER=local) are written here; mount a volume in production.
RUN mkdir -p /app/server/uploads && chown node:node /app/server/uploads
WORKDIR /app/server
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -qO- http://127.0.0.1:4000/api/health || exit 1
CMD ["node", "src/server.js"]
