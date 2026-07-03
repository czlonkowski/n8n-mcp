# syntax=docker/dockerfile:1.7
# Ultra-optimized Dockerfile - minimal runtime dependencies (no n8n packages)

# Stage 1: Builder (TypeScript compilation only)
FROM node:22-alpine AS builder
WORKDIR /app

# Copy tsconfig files for TypeScript compilation
COPY tsconfig*.json ./

# Create minimal package.json and install ONLY build dependencies
# Note: openai and zod are needed for TypeScript compilation of template metadata modules
RUN --mount=type=cache,target=/root/.npm \
    echo '{}' > package.json && \
    npm install --no-save typescript@^5.8.3 @types/node@^22.15.30 @types/express@^5.0.3 \
        @modelcontextprotocol/sdk@1.20.1 dotenv@^16.5.0 express@^5.1.0 axios@^1.10.0 \
        n8n-workflow@^2.4.2 uuid@^11.0.5 @types/uuid@^10.0.0 \
        openai@^4.77.0 zod@3.24.1 lru-cache@^11.2.1 @supabase/supabase-js@^2.57.4

# Copy source and build
COPY src ./src
# Note: src/n8n contains TypeScript types needed for compilation
# These will be compiled but not included in runtime
RUN npx tsc -p tsconfig.build.json

# Stage 2: Runtime (minimal dependencies)
FROM node:22-alpine AS runtime
WORKDIR /app

# Install only essential runtime tools
RUN apk add --no-cache curl su-exec && \
    rm -rf /var/cache/apk/*

# Copy runtime-only package.json
COPY package.runtime.json package.json

# Install runtime dependencies with better-sqlite3 compilation
# Build tools (python3, make, g++) are installed, used for compilation, then removed
# This enables native SQLite (better-sqlite3) instead of sql.js, preventing memory leaks
RUN --mount=type=cache,target=/root/.npm \
    apk add --no-cache python3 make g++ && \
    npm install --production --no-audit --no-fund && \
    apk del python3 make g++

# Copy built application
COPY --from=builder /app/dist ./dist

# Copy pre-built database and required files
# Cache bust: 2025-07-06-trigger-fix-v3 - includes is_trigger=true for webhook,cron,interval,emailReadImap
COPY data/nodes.db ./data/
# Pristine seed copy outside /app/data: volume mounts over /app/data mask the
# bundled database, and the runtime image cannot rebuild it (no n8n packages),
# so the entrypoint seeds custom/empty DB paths from here.
COPY data/nodes.db ./.db-seed/nodes.db
COPY data/skills ./data/skills
COPY src/database/schema-optimized.sql ./src/database/
COPY .env.example ./

# Copy entrypoint script, config parser, and n8n-mcp command
COPY docker/docker-entrypoint.sh /usr/local/bin/
COPY docker/parse-config.js /app/docker/
COPY docker/n8n-mcp /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh /usr/local/bin/n8n-mcp

# Add container labels
LABEL org.opencontainers.image.source="https://github.com/czlonkowski/n8n-mcp"
LABEL org.opencontainers.image.description="n8n MCP Server - Runtime Only"
LABEL org.opencontainers.image.licenses="MIT"
LABEL org.opencontainers.image.title="n8n-mcp"

# Create non-root user with unpredictable UID/GID
# Using a hash of the build time to generate unpredictable IDs
RUN BUILD_HASH=$(date +%s | sha256sum | head -c 8) && \
    UID=$((10000 + 0x${BUILD_HASH} % 50000)) && \
    GID=$((10000 + 0x${BUILD_HASH} % 50000)) && \
    addgroup -g ${GID} -S nodejs && \
    adduser -S nodejs -u ${UID} -G nodejs && \
    chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Set Docker environment flag
ENV IS_DOCKER=true

# Telemetry: Anonymous usage statistics are ENABLED by default
# To opt-out, uncomment the following line:
# ENV N8N_MCP_TELEMETRY_DISABLED=true

# Expose HTTP port (default 3000, configurable via PORT environment variable at runtime)
EXPOSE 3000

# Set stop signal to SIGTERM (default, but explicit is better)
STOPSIGNAL SIGTERM

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD sh -c 'curl -f http://127.0.0.1:${PORT:-3000}/health || exit 1'

# Optimized entrypoint
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "dist/mcp/index.js"]
