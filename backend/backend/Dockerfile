# Multi-stage build for the WAZZAR backend (NestJS).
#
# Was completely missing before this — see
# docs/delivery-notes/MASTER_GAPS_AND_ROADMAP.md, "Production Docker /
# deploy". There was no repeatable way to package this API at all;
# `docker-compose.yml` only ever stood up Postgres for local dev.
#
# Still NOT verified with an actual `docker build` — as of 2026-08-23,
# a Docker daemon runs fine in a sandboxed session, but no container
# registry is reachable from it (confirmed: `docker pull node:20-alpine`
# gets a 403), so the base image itself can never be pulled here. Every
# stage's actual commands (npm ci, npm run build, npm ci --omit=dev)
# have been run directly and pass, and the file is hadolint-clean, but
# that's not the same as a real image assembly. Confirm with a real
# `docker build` on a machine with normal registry access before
# depending on this for deployment — see
# docs/delivery-notes/MASTER_GAPS_AND_ROADMAP.md's Docker update for
# what specifically was and wasn't possible to verify.
#
# Build:  docker build -t wazzar-backend .
# Run:    docker run -p 3000:3000 --env-file .env wazzar-backend

# ---- deps: install ALL deps (incl. dev, needed to compile TS) ----
FROM node:20-alpine AS deps
WORKDIR /app
# bcrypt (a real dependency, see package.json) ships a native addon built
# via node-gyp. node:20-alpine has no C/C++ toolchain by default, so a
# platform without a matching prebuilt musl binary falls back to
# compiling from source and fails outright without these. Build-time
# only — this stage's toolchain never reaches the runtime image below.
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm ci

# ---- build: compile TypeScript -> dist/ ----
FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---- prod-deps: install ONLY production deps for the final image ----
# Same bcrypt/node-gyp reasoning as the deps stage above — this stage's
# node_modules is the one that actually ships in the runtime image, so
# skipping the toolchain here (even though it was added above) would
# still leave the final image broken.
FROM node:20-alpine AS prod-deps
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---- runtime: minimal final image ----
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Run as a non-root user rather than the container default root.
RUN addgroup -S wazzar && adduser -S wazzar -G wazzar

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

USER wazzar
EXPOSE 3000

# security-checks.ts (see src/security-checks.ts) already refuses to
# boot with unsafe production config (missing CORS_ORIGIN, webhook
# secrets, or JWT secrets) — that check runs here automatically since
# NODE_ENV=production is set above.
CMD ["node", "dist/main"]
