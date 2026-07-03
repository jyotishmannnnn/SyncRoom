# SyncRoom — single-image full-stack build (server serves the SPA).
# Used for Fly.io, a VPS, or any container host; Render/Vercel don't need it.
#
#   docker build -t syncroom .
#   docker run -p 3001:3001 -e CLIENT_ORIGIN=https://your.domain syncroom

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
# Runtime deps only (server workspace); shared is bundled into server/dist.
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --omit=dev -w server && npm cache clean --force
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/client/dist client/dist
EXPOSE 3001
USER node
CMD ["node", "server/dist/index.js"]
