#!/usr/bin/env bash
# ==========================================
# KeyVaultJS - Backup de PostgreSQL (H-05)
# ==========================================
# Vuelca la base de datos comprimida y rota los dumps antiguos.
#
#   sudo bash deploy/backup.sh                 # backup rutinario
#   sudo bash deploy/backup.sh --tag pre-deploy
#   sudo bash deploy/backup.sh --restore <archivo.sql.gz>
#
# Pensado para ejecutarse por cron (deploy.sh instala la entrada diaria).
#
# Los dumps contienen blobs cifrados y hashes bcrypt, no contraseñas en claro,
# pero se tratan como material sensible: 0600 y directorio 0700.
# ==========================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"

BACKUP_DIR="${KEYVAULT_BACKUP_DIR:-/var/backups/keyvaultjs}"
RETENTION_DAYS="${KEYVAULT_BACKUP_RETENTION_DAYS:-14}"
DB_CONTAINER="keyvault_db"
TAG="daily"
RESTORE_FILE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tag)      TAG="${2:?--tag necesita un valor}"; shift 2 ;;
    --restore)  RESTORE_FILE="${2:?--restore necesita un archivo}"; shift 2 ;;
    --dir)      BACKUP_DIR="${2:?--dir necesita un valor}"; shift 2 ;;
    -h|--help)  sed -n '2,16p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *)          echo "Opción desconocida: $1" >&2; exit 1 ;;
  esac
done

if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  set -a; source "$ENV_FILE"; set +a
fi
PG_USER="${POSTGRES_USER:-keyvault}"
PG_DB="${POSTGRES_DB:-keyvault}"

if ! docker inspect -f '{{.State.Running}}' "$DB_CONTAINER" 2>/dev/null | grep -q true; then
  echo "[backup] El contenedor $DB_CONTAINER no está corriendo." >&2
  exit 1
fi

# ---------- restauración ----------
if [[ -n "$RESTORE_FILE" ]]; then
  [[ -f "$RESTORE_FILE" ]] || { echo "[backup] No existe: $RESTORE_FILE" >&2; exit 1; }
  echo "[backup] ATENCIÓN: se va a sobrescribir la base '$PG_DB' con $RESTORE_FILE"
  read -r -p "         Escribe 'RESTAURAR' para confirmar: " reply
  [[ "$reply" == "RESTAURAR" ]] || { echo "[backup] Cancelado."; exit 1; }

  gunzip -c "$RESTORE_FILE" \
    | docker exec -i "$DB_CONTAINER" psql -v ON_ERROR_STOP=1 -U "$PG_USER" -d "$PG_DB"
  echo "[backup] Restauración completada."
  exit 0
fi

# ---------- volcado ----------
install -d -m 0700 "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
TARGET="$BACKUP_DIR/${TAG}-${STAMP}.sql.gz"

# --clean --if-exists deja el dump listo para restaurar sobre una base existente.
docker exec "$DB_CONTAINER" pg_dump -U "$PG_USER" -d "$PG_DB" --clean --if-exists \
  | gzip -9 > "$TARGET.partial"
mv "$TARGET.partial" "$TARGET"
chmod 600 "$TARGET"

SIZE="$(du -h "$TARGET" | cut -f1)"
echo "[backup] Creado $TARGET ($SIZE)"

# ---------- rotación ----------
DELETED="$(find "$BACKUP_DIR" -maxdepth 1 -name '*.sql.gz' -type f -mtime "+$RETENTION_DAYS" -print -delete | wc -l)"
[[ "$DELETED" -gt 0 ]] && echo "[backup] Rotación: $DELETED dump(s) de más de $RETENTION_DAYS días eliminados."

echo "[backup] OK. Restaurar con: sudo bash deploy/backup.sh --restore $TARGET"
