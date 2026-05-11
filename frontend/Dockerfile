# Stage 1: Build
FROM node:20-alpine AS build

WORKDIR /app

# NOTE: VITE_API_URL is NOT baked in at build time.
# It is injected at container start by /docker-entrypoint.d/30-runtime-config.sh
# which reads $VITE_API_URL (provided via docker-compose env_file: .env) and writes
# /usr/share/nginx/html/config.js. The browser loads that file before main.jsx.

# Install dependencies with better caching
COPY package*.json ./
RUN npm ci --only=production=false

# Copy source files
COPY . .

# Build
RUN npm run build && \
    ls -la dist/ && \
    echo "Build completed successfully"

# Stage 2: Production
FROM nginx:alpine

# Install wget for healthcheck
RUN apk add --no-cache wget

# Copy custom nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy build artifacts from stage 1
COPY --from=build /app/dist /usr/share/nginx/html

# Runtime config injector: nginx:alpine runs every *.sh under /docker-entrypoint.d/
# before starting nginx, so this script rewrites config.js using the container's env.
COPY docker-entrypoint-config.sh /docker-entrypoint.d/30-runtime-config.sh
RUN chmod +x /docker-entrypoint.d/30-runtime-config.sh

# Verify files were copied
RUN ls -la /usr/share/nginx/html/ && \
    test -f /usr/share/nginx/html/index.html || exit 1

# Expose port
EXPOSE 5020

# Test nginx config before starting
RUN nginx -t

CMD ["nginx", "-g", "daemon off;"]
