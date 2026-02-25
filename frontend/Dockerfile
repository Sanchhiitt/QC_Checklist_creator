# Stage 1: Build
FROM node:20-alpine AS build

WORKDIR /app

# Install dependencies with better caching
COPY package*.json ./
RUN npm ci --only=production=false

# Copy source files
COPY . .

# Build with error checking
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

# Verify files were copied
RUN ls -la /usr/share/nginx/html/ && \
    test -f /usr/share/nginx/html/index.html || exit 1

# Expose port
EXPOSE 4444

# Test nginx config before starting
RUN nginx -t

CMD ["nginx", "-g", "daemon off;"]
