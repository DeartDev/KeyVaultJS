# ==========================================
# KeyVaultJS Web (nginx) - Dockerfile
# ==========================================
FROM nginx:1.27-alpine@sha256:65645c7bb6a0661892a8b03b89d0743208a18dd2f3f17a54ef4b76fb8e2f2a10

LABEL org.opencontainers.image.title="KeyVaultJS Web"
LABEL org.opencontainers.image.description="Static frontend + reverse proxy to the API"

# Copy frontend static assets.
COPY index.html /usr/share/nginx/html/index.html
COPY keyvault.svg /usr/share/nginx/html/keyvault.svg
COPY icons/     /usr/share/nginx/html/icons/
COPY css/       /usr/share/nginx/html/css/
COPY js/        /usr/share/nginx/html/js/
COPY manifest.json      /usr/share/nginx/html/manifest.json
COPY service-worker.js  /usr/share/nginx/html/service-worker.js

# nginx config (SPA fallback + /api proxy + cabeceras de seguridad).
COPY web/nginx.conf            /etc/nginx/conf.d/default.conf
COPY web/security-headers.conf /etc/nginx/keyvault/security-headers.conf
COPY web/proxy.conf            /etc/nginx/keyvault/proxy.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
