# syntax=docker/dockerfile:1
#
# Audit Filter frontend — production image.
# Build context is frontend/ :  docker build -t audit-frontend ./frontend
#
# Multi-stage: a Node stage compiles the app, an nginx stage serves the result.
# The Node toolchain never ships to the VM — the final image contains static
# files and a web server, nothing else. That also sidesteps the Node 18 problem
# on your dev box entirely: the build runs on node:22 inside Docker regardless
# of what `node -v` says on WSL.

# ---------- stage 1: build ----------
FROM node:22-alpine AS build

WORKDIR /app

# Manifests first, for the same layer-cache reason as requirements.txt.
# `npm ci` (not `npm install`) installs exactly what package-lock.json pins and
# fails if the lockfile is out of sync — a build should never silently resolve
# a different dependency tree than the one you tested.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Vite inlines VITE_* variables into the bundle at BUILD time — they are not
# read at runtime. So they must be present here, as build args.
#
# .env.local is gitignored, so it will not exist in a clean clone or on a build
# server. Declaring the values explicitly makes the build reproducible instead
# of dependent on an untracked file. Defaults match .env.example: talk to the
# real backend, same-origin.
ARG VITE_USE_MOCKS=false
ARG VITE_API_BASE_URL=
ENV VITE_USE_MOCKS=$VITE_USE_MOCKS \
    VITE_API_BASE_URL=$VITE_API_BASE_URL

# package.json runs `tsc -b && vite build` — a type error fails the image build.
RUN npm run build

# ---------- stage 2: serve ----------
FROM nginx:alpine AS serve

# Only the compiled output crosses the stage boundary. node_modules, the source,
# and the Node runtime are all left behind in stage 1.
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -q --spider http://127.0.0.1/ || exit 1
