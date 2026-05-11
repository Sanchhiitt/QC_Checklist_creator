// Default runtime config. In Docker this file gets overwritten by docker-entrypoint
// before nginx starts, using values from the container's environment (passed via env_file).
// For `npm run dev` Vite serves this file as-is and api.js falls back to import.meta.env.VITE_API_URL.
window.RUNTIME_CONFIG = window.RUNTIME_CONFIG || {};
