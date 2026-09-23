# Multi-stage build: compile TypeScript, ship only production deps.
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
# Runs over stdio; start a second process only to keep stdin open when reading
# --help or for shells without a TTY is unnecessary — attach stdin directly.
ENTRYPOINT ["node", "dist/index.js"]
# Documentation: mounting a watch folder is the normal way to feed images:
#   docker run -i --rm -e GEMINI_API_KEY=... \
#     -v ~/screenshots:/data/images ghcr.io/usher-pb/sightline-mcp
