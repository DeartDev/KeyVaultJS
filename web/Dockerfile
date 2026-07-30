# ==========================================
# KeyVaultJS Web (nginx) - Dockerfile
# ==========================================
FROM nginx:1.27-alpine

LABEL org.opencontainers.image.title="KeyVaultJS Web"
LABEL org.opencontainers.image.description="Static frontend + reverse proxy to the API"

# Copy frontend static assets.
COPY index.html /usr/share/nginx/html/index.html
COPY keyvault.svg /usr/share/nginx/html/keyvault.svg
COPY css/       /usr/share/nginx/html/css/
COPY js/        /usr/share/nginx/html/js/
COPY manifest.json      /usr/share/nginx/html/manifest.json
COPY service-worker.js  /usr/share/nginx/html/service-worker.js

# nginx config (SPA fallback + /api proxy).
COPY web/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
