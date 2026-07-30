#!/usr/bin/env bash
# ==========================================
# KeyVaultJS - Apache vhost + SSL setup
# ==========================================
# Invoked by install.sh. Configures an Apache reverse proxy pointing to
# http://127.0.0.1:8084 and, if an email is provided, issues a Let's Encrypt
# certificate via certbot with automatic HTTPS redirect.
#
# Usage:
#   sudo setup-apache.sh <domain> [email]
#
# Requires root. Exits non-zero on failure.
# ==========================================
set -euo pipefail

DOMAIN="${1:-}"
EMAIL="${2:-}"

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
