#!/bin/sh
# Runs before nginx starts (nginx:alpine auto-executes /docker-entrypoint.d/*.sh).
# Reads runtime env vars (passed via docker-compose env_file: .env) and writes them
# into /usr/share/nginx/html/config.js so the browser can pick them up at page load.

set -e

CONFIG_FILE="/usr/share/nginx/html/config.js"

if [ -z "$VITE_API_URL" ]; then
    echo "[entrypoint] ERROR: VITE_API_URL is not set. Add it to frontend/.env." >&2
    exit 1
fi

cat > "$CONFIG_FILE" <<EOF
window.RUNTIME_CONFIG = {
  VITE_API_URL: "${VITE_API_URL}"
};
EOF

echo "[entrypoint] wrote runtime config:"
cat "$CONFIG_FILE"
