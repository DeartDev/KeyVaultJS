# ==========================================
# KeyVaultJS API - Dockerfile (multi-stage)
# ==========================================

# --- Stage 1: deps ---
FROM node:20-bookworm-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0 AS deps
WORKDIR /app

# OpenSSL y CA certs para bcrypt y TLS.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev

# --- Stage 2: runtime ---
FROM node:20-bookworm-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0 AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    NODE_OPTIONS="--enable-source-maps"

# Non-root user.
RUN groupadd --system app && useradd --system --gid app --create-home app

COPY --from=deps /app/node_modules ./node_modules
COPY package*.json ./
COPY src ./src
COPY test ./test

RUN chown -R app:app /app
USER app

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
