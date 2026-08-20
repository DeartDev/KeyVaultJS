#!/usr/bin/env bash
# ==========================================
# KeyVaultJS - Apache vhost + SSL setup
# ==========================================
# Invoked by install.sh. Configures an Apache reverse proxy pointing to
# http://127.0.0.1:8084 and, if an email is provided, issues a Let's Encrypt
# certificate via certbot with automatic HTTPS redirect.
#
# Usage:
#   sudo setup-apache.sh <domain> [email] [--no-hsts]
#
# Requires root. Exits non-zero on failure.
# ==========================================
set -euo pipefail

DOMAIN="${1:-}"
EMAIL="${2:-}"
ENABLE_HSTS=1
[[ "${3:-}" == "--no-hsts" ]] && ENABLE_HSTS=0

if [[ $EUID -ne 0 ]]; then
  echo "[apache] This script must be run as root (sudo)." >&2
  exit 1
fi

if [[ -z "$DOMAIN" ]]; then
  echo "[apache] Domain is required." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE="$SCRIPT_DIR/keyvault.example.conf"
TARGET="/etc/apache2/sites-available/keyvault.conf"
PORTS_FILE="/etc/apache2/ports.conf"

echo "[apache] Enabling required Apache modules..."
a2enmod proxy proxy_http ssl rewrite headers >/dev/null

# Ensure mod_proxy listens correctly (default ports.conf already has *:80).
if ! grep -q "Listen 80" "$PORTS_FILE" 2>/dev/null; then
  echo "Listen 80" >> "$PORTS_FILE"
fi

echo "[apache] Rendering vhost for domain: $DOMAIN"
tmp="$(mktemp)"
sed "s/\${DOMAIN}/${DOMAIN}/g" "$TEMPLATE" > "$tmp"
install -m 0644 "$tmp" "$TARGET"
rm -f "$tmp"

echo "[apache] Enabling site..."
a2ensite keyvault >/dev/null

echo "[apache] Validating configuration..."
if ! apache2ctl configtest; then
  echo "[apache] Configuration test failed. Aborting." >&2
  exit 1
fi

echo "[apache] Reloading Apache..."
systemctl reload apache2 || systemctl restart apache2

# ---------- HSTS en el vhost TLS (H-08) ----------
# Se añade DESPUÉS de certbot, sobre el vhost :443 que él genera. Nunca en el
# vhost :80: HSTS sobre HTTP plano se ignora y, si el certificado fallara, un
# navegador que ya lo recibió no podría volver a HTTP durante max-age.
add_hsts() {
  local ssl_conf
  for ssl_conf in "/etc/apache2/sites-available/keyvault-le-ssl.conf" \
                  "/etc/apache2/sites-available/keyvault-ssl.conf"; do
    [[ -f "$ssl_conf" ]] || continue
    if grep -q "Strict-Transport-Security" "$ssl_conf"; then
      echo "[apache] HSTS ya estaba configurado en $(basename "$ssl_conf")."
      return 0
    fi
    echo "[apache] Añadiendo HSTS a $(basename "$ssl_conf")..."
    sed -i 's|</VirtualHost>|    <IfModule mod_headers.c>\n        Header always set Strict-Transport-Security "max-age=31536000; includeSubDomains"\n    </IfModule>\n</VirtualHost>|' "$ssl_conf"
    if apache2ctl configtest >/dev/null 2>&1; then
      systemctl reload apache2
      echo "[apache] HSTS activo (max-age=1 año). Revertirlo requiere esperar a que"
      echo "[apache] caduque en cada navegador: no lo actives si HTTPS no es estable."
    else
      echo "[apache] [WARN] configtest falló tras añadir HSTS; revirtiendo." >&2
      sed -i '/Strict-Transport-Security/d' "$ssl_conf"
    fi
    return 0
  done
  echo "[apache] [WARN] No se encontró el vhost TLS; HSTS no se aplicó." >&2
}

# ---------- SSL via certbot ----------
if [[ -n "$EMAIL" ]]; then
  if ! command -v certbot >/dev/null 2>&1; then
    echo "[apache] certbot not found. Install with: apt-get install -y certbot python3-certbot-apache" >&2
    exit 1
  fi

  echo "[apache] Requesting Let's Encrypt certificate for $DOMAIN..."
  if certbot --apache -d "$DOMAIN" \
      --non-interactive \
      --agree-tos \
      --redirect \
      -m "$EMAIL"; then
    echo "[apache] SSL certificate installed and HTTPS redirect enabled."
    [[ $ENABLE_HSTS -eq 1 ]] && add_hsts
  else
    echo "[apache] [WARN] certbot failed. Apache is serving HTTP only. Re-run certbot manually:" >&2
    echo "          sudo certbot --apache -d $DOMAIN" >&2
    exit 2
  fi
else
  echo "[apache] No email provided. Skipping SSL (HTTP only)."
  echo "[apache] To enable HTTPS later, run:"
  echo "          sudo certbot --apache -d $DOMAIN"
fi

echo "[apache] Done."
