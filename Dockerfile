# SoulEngine container image, built for Google Cloud Run.
#
# Cloud Run injects PORT and expects the process to listen on 0.0.0.0. The
# server already does both: src/index.ts reads PORT via src/config.ts and
# @hono/node-server binds all interfaces by default.
#
# Node 20 to match the version CI type-checks and tests against
# (.github/workflows/deploy.yml).

# ---- build ----------------------------------------------------------------
FROM node:20-slim AS build

WORKDIR /app

# Dependencies first so a source-only change reuses this layer.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- runtime --------------------------------------------------------------
FROM node:20-slim AS runtime

ENV NODE_ENV=production

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

# The server serves the studio and the templates off disk, resolved against
# process.cwd() (src/index.ts:269 and :280), so both have to be in the image
# at the working directory.
COPY web ./web
COPY data/templates ./data/templates
COPY data/starter-pack ./data/starter-pack

# Drop privileges. The base image ships an unprivileged `node` user.
USER node

# Documentation only -- Cloud Run overrides this with its own PORT.
EXPOSE 8080

CMD ["node", "dist/index.js"]
