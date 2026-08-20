#!/usr/bin/env bash
# ==========================================
# KeyVaultJS - install.sh (DEPRECADO)
# ==========================================
# Sustituido por deploy/deploy.sh, que es no interactivo, hace backup previo,
# verifica que ningún puerto quede expuesto y permite rollback.
#
# Este wrapper se mantiene una versión para no romper automatismos existentes.
# ==========================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "[!] deploy/install.sh está DEPRECADO. Usa deploy/deploy.sh:"
echo "      sudo bash deploy/deploy.sh --prod --domain <dominio> --email <email>"
echo "           bash deploy/deploy.sh --local"
echo ""

MODE="--prod"
if [[ $EUID -ne 0 ]]; then
  echo "[!] Sin root: se asume modo local."
  MODE="--local"
fi

echo "[*] Redirigiendo a deploy.sh $MODE $*"
exec bash "$SCRIPT_DIR/deploy.sh" "$MODE" "$@"
