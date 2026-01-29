# SEO Articles Backend - Multi-target Dockerfile

FROM node:20-alpine AS base

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies
RUN npm install

# Copy source
COPY . .

# Build TypeScript
RUN npm run build

# ============================================
# API Server target
# ============================================
FROM base AS api

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/api/health || exit 1

ENV NODE_ENV=production
EXPOSE 3001

CMD ["node", "dist/index.js"]

# ============================================
# Worker target
# ============================================
FROM base AS worker

ENV NODE_ENV=production

CMD ["node", "dist/worker.js"]
