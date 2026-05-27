# Portal de produção — imagem única (single deployable).
# Multi-stage: build da SPA + build do servidor → runtime slim não-root.
# Node 22 (node:sqlite embutido — zero dep nativa, sem toolchain de build).

# ---- 1. Build da SPA (Vite) ----
FROM node:22-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

# ---- 2. Build do servidor (tsc) ----
FROM node:22-alpine AS server
WORKDIR /srv
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ---- 3. Runtime ----
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
# Só deps de produção (tsx/tsc/vitest ficam de fora).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=server /srv/dist ./dist
COPY --from=web /web/dist ./web/dist
# org.json NÃO é copiado pra imagem (era COPY → invalidava layer e exigia
# rebuild a cada mudança de roster). Vira BIND MOUNT no docker-compose
# (./org.json:/app/org.json:ro) → editar no host atualiza o container na
# próxima request (orgManifest() lê sem cache). Dev local segue funcionando
# (ORG_MANIFEST_PATH=./org.json resolve no cwd).

# Não-root (UID 1000 = user `node` da imagem oficial, igual ao container
# OpenClaw). /data é volume (sqlite + vault); /repo é mount read-only.
RUN mkdir -p /data && chown -R node:node /app /data
USER node
ENV DATA_DIR=/data REPO_DIR=/repo PORT=8080
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null 2>&1 || exit 1

CMD ["node", "dist/server.js"]
